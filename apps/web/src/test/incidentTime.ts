import type { ImportedSourceRecord, IncidentTimeDiagnostics } from "../generated/imports";

/*
 * The time diagnostics the local service supplies with the records of an incident, built for
 * records written by hand in tests, by the rules of the contract: a known order has every time
 * usable and ascending, and gives the exact gaps, the span, the maximum, its first two records and
 * the count of equal ones; an order that is not known gives none of them. Times are read as written.
 */
const HOUR = 3_600_000_000;
const written = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z?$/;

/** The microseconds since 1970 of a time as written, on its own clock. */
function clockOf(text: string): bigint {
  const [, seconds, fraction = ""] = written.exec(text) ?? [];
  if (seconds === undefined) throw new Error(`Not a canonical time: ${text}`);
  return BigInt(Date.parse(`${seconds}Z`)) * 1000n + BigInt(fraction.padEnd(6, "0"));
}

const keyOf = (record: ImportedSourceRecord) => (record.timestamp_status === "usable" ? (record.utc_instant ?? record.local_timestamp) : null);
const hours = (microseconds: bigint) => Number(microseconds) / HOUR;

export function diagnosticsFor(records: readonly ImportedSourceRecord[], evaluable: boolean): IncidentTimeDiagnostics {
  const wall = records.some((record) => record.timestamp_kind === "wall_clock");
  const clock = wall
    ? ({ timestamp_kind: "wall_clock", duration_basis: "recorded_wall_clock", clock_limitation: "recorded_wall_duration_may_differ_from_physical_elapsed" } as const)
    : ({ timestamp_kind: "utc_instant", duration_basis: "elapsed_utc", clock_limitation: null } as const);
  const keys = records.map(keyOf);
  const policy = { policy_id: "incident.time_diagnostics.full_raw_declared_order.v1" as const, ...clock };
  if (!evaluable) {
    return {
      ...policy,
      summary: {
        status: "unavailable",
        reason: "order_unknown",
        unavailable_timestamp_record_count: keys.filter((key) => key === null).length,
        first_recorded_timestamp: null,
        last_recorded_timestamp: null,
        first_recorded_activity: null,
        last_recorded_activity: null,
        observed_span_hours: null,
        observed_span_unavailable_reason: "order_unknown",
        maximum_adjacent_raw_gap_hours: null,
        maximum_adjacent_raw_gap_unavailable_reason: "order_unknown",
        maximum_gap_witness: null,
        usable_gap_count: 0,
        tied_timestamp_group_count: null,
      },
      observed_span_microseconds: null,
      maximum_adjacent_raw_gap_microseconds: null,
      maximum_gap_equal_count: null,
      records: records.map((record, place) => ({
        row_id: record.row_id,
        timestamp_key: keys[place],
        clock_microseconds: keys[place] === null ? null : String(clockOf(keys[place])),
        offset_from_first_record_microseconds: null,
        gap_before: { status: "unavailable", reason: "order_unknown", from_row_id: null, microseconds: null, hours: null },
      })),
    } as unknown as IncidentTimeDiagnostics;
  }
  if (keys.some((key) => key === null)) throw new Error("A known order has every time usable.");
  const times = keys.map((key) => clockOf(key!));
  const gaps = times.map((time, place) => (place === 0 ? null : time - times[place - 1]));
  if (gaps.some((gap) => gap !== null && gap < 0n)) throw new Error("A known order has its times ascending.");
  const span = times[times.length - 1] - times[0];
  const known = gaps.filter((gap): gap is bigint => gap !== null);
  const maximum = known.length === 0 ? null : known.reduce((most, gap) => (gap > most ? gap : most), known[0]);
  const first = maximum === null ? -1 : gaps.findIndex((gap) => gap === maximum);
  const ties = times.filter((time, place) => place > 0 && time === times[place - 1] && (place === 1 || times[place - 2] !== time)).length;
  return {
    ...policy,
    summary: {
      status: "available",
      timestamp_kind: clock.timestamp_kind,
      first_recorded_timestamp: keys[0],
      last_recorded_timestamp: keys[keys.length - 1],
      first_recorded_activity: records[0].activity,
      last_recorded_activity: records[records.length - 1].activity,
      observed_span_hours: hours(span),
      observed_span_unavailable_reason: null,
      maximum_adjacent_raw_gap_hours: maximum === null ? null : hours(maximum),
      maximum_adjacent_raw_gap_unavailable_reason: maximum === null ? "fewer_than_two_records" : null,
      maximum_gap_witness:
        maximum === null
          ? null
          : {
              from_row_id: records[first - 1].row_id,
              to_row_id: records[first].row_id,
              from_activity: records[first - 1].activity,
              to_activity: records[first].activity,
              from_offset_hours: hours(times[first - 1] - times[0]),
              share_of_observed_span: span === 0n ? null : hours(maximum) / hours(span),
              share_unavailable_reason: span === 0n ? "zero_observed_span" : null,
            },
      usable_gap_count: known.length,
      tied_timestamp_group_count: ties,
    },
    observed_span_microseconds: String(span),
    maximum_adjacent_raw_gap_microseconds: maximum === null ? null : String(maximum),
    maximum_gap_equal_count: maximum === null ? null : known.filter((gap) => gap === maximum).length,
    records: records.map((record, place) => ({
      row_id: record.row_id,
      timestamp_key: keys[place],
      clock_microseconds: String(times[place]),
      offset_from_first_record_microseconds: String(times[place] - times[0]),
      gap_before:
        place === 0
          ? { status: "unavailable", reason: "first_record", from_row_id: null, microseconds: null, hours: null }
          : { status: "available", from_row_id: records[place - 1].row_id, microseconds: String(gaps[place]), hours: hours(gaps[place]!) },
    })),
  } as unknown as IncidentTimeDiagnostics;
}
