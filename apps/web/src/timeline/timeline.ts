import type { ImportedSourceRecord, IncidentTimeDiagnostics } from "../generated/imports";

/*
 * The elapsed time of one incident as the local service supplies it with the records: where each
 * distinct recorded time lies between the earliest and the latest, the gap before each record in
 * the declared order, and the longest gap with the number of gaps as long. Every difference, the
 * maximum, its two records and the count of equal ones are the service's; exact values are kept as
 * integers of microseconds, and a JavaScript number is made of them only to place and to word.
 * Nothing here sorts, drops or merges a record of the list.
 */

/** What the timeline reads of a record of the list: its place in the source rows, by which the diagnostics are bound to it. */
export type ListedRow = Pick<ImportedSourceRecord, "row_id">;

export type Clock = IncidentTimeDiagnostics["timestamp_kind"];

/** One distinct recorded time and the records that carry exactly it. */
export interface Mark {
  /** The time in microseconds on the clock of the incident, exact however far from today it lies. */
  time: bigint;
  /** Where the mark lies on the strip: 0 at the earliest time, 1 at the latest. */
  position: number;
  /** The places in the list of the records at this time, in the declared order. */
  records: number[];
}

export type Strip =
  /** Two or more distinct times: an axis from the earliest to the latest, that many microseconds long. */
  | { kind: "axis"; marks: Mark[]; microseconds: number }
  /** Every record with a usable time carries the same one, so there is no axis. */
  | { kind: "one_time"; mark: Mark }
  | { kind: "no_time" }
  /** The local service supplied no time diagnostics for the incident, or none that belong to its records: nothing is drawn or computed. */
  | { kind: "not_supplied"; reason: "omitted" | "mismatch" };

/** What lies between a record and the record before it in the list. */
export type Gap =
  /** The first record of the list: no record lies before it. */
  | { kind: "first" }
  /** The supplied time from the record before to this one: exact, and as a number for words and drawing; 0 when both carry the same time. */
  | { kind: "elapsed"; exact: bigint; microseconds: number };

export interface LongestGap {
  /** The places in the list of the two records the gap lies between. */
  from: number;
  to: number;
  exact: bigint;
  microseconds: number;
  /** How many gaps of the incident have this length, as supplied; the one named is the first in the declared order. */
  equalCount: number;
}

export interface Timeline {
  /** The clock of the supplied times; null where nothing was supplied. */
  clock: Clock | null;
  /** What the local service says of that clock, where it is a recorded wall clock. */
  clockLimitation: string | null;
  strip: Strip;
  /** How many records have no usable time; they are on no mark. */
  untimedCount: number;
  /** The places in the list of the records without a usable time, in the declared order. */
  untimed: number[];
  /** That no gap is given because the order of the records is not known; null when the gaps are given or nothing was supplied. */
  withheld: "order" | null;
  /** The gap before each record, in the declared order; empty when the gaps are withheld or nothing was supplied. */
  gaps: Gap[];
  /**
   * The longest gap between two consecutive records, the first of equal ones. It is zero when every
   * record follows the one before at the same recorded time; null when no gap is given at all.
   */
  longest: LongestGap | null;
}

const nothing = (reason: "omitted" | "mismatch"): Timeline => ({
  clock: null,
  clockLimitation: null,
  strip: { kind: "not_supplied", reason },
  untimedCount: 0,
  untimed: [],
  withheld: null,
  gaps: [],
  longest: null,
});

/** An exact count of microseconds and the number made of it for words and drawing. */
const exactly = (text: string) => ({ exact: BigInt(text), microseconds: Number(BigInt(text)) });

/**
 * The timeline of an incident from the diagnostics the local service supplied with its records.
 * The diagnostics belong to the records place by place; where they do not, or where none were
 * supplied, nothing is computed in their stead.
 */
export function suppliedTimeline(records: readonly ListedRow[], diagnostics: IncidentTimeDiagnostics | undefined): Timeline {
  if (diagnostics === undefined) return nothing("omitted");
  const rows: readonly { row_id: string; timestamp_key: string | null; clock_microseconds: string | null; gap_before: { status: string; microseconds: string | null } }[] =
    diagnostics.records;
  if (rows.length !== records.length || rows.some((row, place) => row.row_id !== records[place].row_id)) return nothing("mismatch");
  const times = rows.map((row) => (row.timestamp_key === null || row.clock_microseconds === null ? null : BigInt(row.clock_microseconds)));
  const untimed = times.flatMap((time, place) => (time === null ? [place] : []));
  const base = {
    clock: diagnostics.timestamp_kind,
    clockLimitation: diagnostics.clock_limitation,
    strip: stripOf(times),
    untimedCount: untimed.length,
    untimed,
  };
  // Without a known order it is not known which record follows which, so the service gives no gap and no maximum.
  if (diagnostics.observed_span_microseconds === null) return { ...base, withheld: "order", gaps: [], longest: null };
  const gaps: Gap[] = rows.map((row) =>
    row.gap_before.status === "available" && row.gap_before.microseconds !== null ? { kind: "elapsed", ...exactly(row.gap_before.microseconds) } : { kind: "first" },
  );
  const witness = diagnostics.summary.maximum_gap_witness;
  const maximum = diagnostics.maximum_adjacent_raw_gap_microseconds;
  const placeOf = (rowId: string) => rows.findIndex((row) => row.row_id === rowId);
  const longest =
    witness && maximum !== null && diagnostics.maximum_gap_equal_count !== null
      ? { from: placeOf(witness.from_row_id), to: placeOf(witness.to_row_id), ...exactly(maximum), equalCount: diagnostics.maximum_gap_equal_count }
      : null;
  return { ...base, withheld: null, gaps, longest };
}

/** The marks of the supplied times: one per distinct time, in the order of time, each with its records in the order of the list. */
export function stripOf(times: readonly (bigint | null)[]): Exclude<Strip, { kind: "not_supplied" }> {
  const recordsAt = new Map<bigint, number[]>();
  times.forEach((time, place) => {
    if (time === null) return;
    const records = recordsAt.get(time);
    if (records) records.push(place);
    else recordsAt.set(time, [place]);
  });
  const distinct = [...recordsAt.keys()].sort((one, other) => (one < other ? -1 : one > other ? 1 : 0));
  if (distinct.length === 0) return { kind: "no_time" };
  const earliest = distinct[0];
  const microseconds = Number(distinct[distinct.length - 1] - earliest);
  const marks = distinct.map((time) => ({ time, position: microseconds === 0 ? 0 : Number(time - earliest) / microseconds, records: recordsAt.get(time) ?? [] }));
  return marks.length === 1 ? { kind: "one_time", mark: marks[0] } : { kind: "axis", marks, microseconds };
}
