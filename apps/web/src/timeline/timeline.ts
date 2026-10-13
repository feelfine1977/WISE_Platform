import type { ImportedSourceRecord2 } from "../generated/imports";

/*
 * The elapsed time of one incident, computed in the browser from the times of its records as the
 * local service supplied them: where each distinct time lies between the earliest and the latest,
 * and the plain difference between a record and the record before it in the declared order.
 * Nothing here sorts, drops or merges a record of the list; what is not computed has its reason.
 */

/** What the timeline reads of a record: its time as supplied. */
export type RecordTime = Pick<ImportedSourceRecord2, "timestamp_kind" | "timestamp_status" | "utc_instant" | "local_timestamp">;

export type Clock = RecordTime["timestamp_kind"];

/** One distinct recorded time and the records that carry exactly it. */
export interface Mark {
  /** The time in microseconds on the clock of the incident. */
  time: number;
  /** Where the mark lies on the strip: 0 at the earliest time, 1 at the latest. */
  position: number;
  /** The places in the list of the records at this time, in the declared order. */
  records: number[];
}

export type Strip =
  /** Two or more distinct times: an axis from the earliest to the latest, that many microseconds long. */
  | { kind: "axis"; marks: Mark[]; microseconds: number }
  /** Every record with a readable time carries the same one, so there is no axis. */
  | { kind: "one_time"; mark: Mark }
  | { kind: "no_time" }
  /** The records carry times of both kinds, which are not compared. */
  | { kind: "two_clocks" };

/** What lies between a record and the record before it in the list. */
export type Gap =
  /** The first record of the list: no record lies before it. */
  | { kind: "first" }
  /** The time of this record less the time of the record before; 0 when both carry the same time. */
  | { kind: "elapsed"; microseconds: number }
  /** The time of this record lies that much before the time of the record before; no gap is computed. */
  | { kind: "earlier"; microseconds: number }
  /** This record, or the record before it, has no readable time; no gap is computed across it. */
  | { kind: "untimed"; record: "this" | "before" };

export interface LongestGap {
  /** The places in the list of the two records the gap lies between. */
  from: number;
  to: number;
  microseconds: number;
  /** How many gaps of the incident have this length; the one named is the first in the declared order. */
  equalCount: number;
}

export interface Timeline {
  /** The clock of the readable times; null when no time is readable or the records carry both kinds. */
  clock: Clock | null;
  strip: Strip;
  /** How many records have no readable time; they are on no mark. */
  untimedCount: number;
  /** Why no gap is computed for any record of the incident, or null when the gaps are computed. */
  withheld: "order" | "clocks" | null;
  /** The gap before each record, in the declared order; empty when the gaps are withheld. */
  gaps: Gap[];
  /** The longest gap above zero, or null when there is none. */
  longest: LongestGap | null;
}

const written = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z?$/;

/**
 * The supplied time of a record in microseconds on its own clock, or null when the record has no
 * readable time. A wall-clock time is read as it is written, without a zone, so its differences
 * are those of the recorded clock.
 */
export function microsecondsOf(record: RecordTime): number | null {
  if (record.timestamp_status !== "usable") return null;
  const text = record.timestamp_kind === "utc_instant" ? record.utc_instant : record.local_timestamp;
  const parts = text === null ? null : written.exec(text);
  if (text === null || parts === null) return null;
  const [, year, month, day, hour, minute, second, fraction = ""] = parts;
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(Number(hour), Number(minute), Number(second));
  // A text that names no day of the calendar or no time of the day comes back as another one.
  if (date.toISOString().slice(0, 19) !== text.slice(0, 19)) return null;
  return date.getTime() * 1000 + Number(fraction.padEnd(6, "0"));
}

/** The timeline of the records of one incident in their declared order, and of what the local service says about that order. */
export function timelineOf(records: readonly RecordTime[], sequenceEvaluable: boolean): Timeline {
  const times = records.map(microsecondsOf);
  const untimedCount = times.filter((time) => time === null).length;
  const clocks = new Set(records.filter((_, place) => times[place] !== null).map((record) => record.timestamp_kind));
  if (clocks.size > 1) {
    return { clock: null, strip: { kind: "two_clocks" }, untimedCount, withheld: "clocks", gaps: [], longest: null };
  }
  const [clock = null] = clocks;
  const strip = stripOf(times);
  // Without a known order it is not known which record follows which, so no gap is a gap between two consecutive records.
  if (!sequenceEvaluable) return { clock, strip, untimedCount, withheld: "order", gaps: [], longest: null };
  const gaps = times.map((time, place) => gapOf(place === 0 ? undefined : times[place - 1], time));
  return { clock, strip, untimedCount, withheld: null, gaps, longest: longestOf(gaps) };
}

function stripOf(times: readonly (number | null)[]): Strip {
  const recordsAt = new Map<number, number[]>();
  times.forEach((time, place) => {
    if (time === null) return;
    const records = recordsAt.get(time);
    if (records) records.push(place);
    else recordsAt.set(time, [place]);
  });
  // The marks stand in the order of their times; the records of a mark keep the order of the list.
  const distinct = [...recordsAt.keys()].sort((one, other) => one - other);
  if (distinct.length === 0) return { kind: "no_time" };
  const earliest = distinct[0];
  const microseconds = distinct[distinct.length - 1] - earliest;
  const marks = distinct.map((time) => ({ time, position: microseconds === 0 ? 0 : (time - earliest) / microseconds, records: recordsAt.get(time) ?? [] }));
  return marks.length === 1 ? { kind: "one_time", mark: marks[0] } : { kind: "axis", marks, microseconds };
}

/** The gap of a record with this time after a record with that time; `undefined` before the first record of the list. */
function gapOf(before: number | null | undefined, time: number | null): Gap {
  if (before === undefined) return { kind: "first" };
  if (time === null) return { kind: "untimed", record: "this" };
  if (before === null) return { kind: "untimed", record: "before" };
  return time < before ? { kind: "earlier", microseconds: before - time } : { kind: "elapsed", microseconds: time - before };
}

function longestOf(gaps: readonly Gap[]): LongestGap | null {
  let longest: LongestGap | null = null;
  for (const [place, gap] of gaps.entries()) {
    if (gap.kind !== "elapsed" || gap.microseconds === 0) continue;
    // Only a longer gap replaces the one found: of equal gaps the first in the declared order stays.
    if (longest === null || gap.microseconds > longest.microseconds) longest = { from: place - 1, to: place, microseconds: gap.microseconds, equalCount: 1 };
    else if (gap.microseconds === longest.microseconds) longest.equalCount += 1;
  }
  return longest;
}
