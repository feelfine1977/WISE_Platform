import { describe, expect, it } from "vitest";
import { microsecondsOf, timelineOf, type RecordTime } from "./timeline";

/*
 * Records written by hand for these tests, with times chosen so that every difference can be
 * checked by eye. One hour is 3,600,000,000 microseconds.
 */
const HOUR = 3_600_000_000;

const at = (instant: string): RecordTime => ({ timestamp_kind: "utc_instant", timestamp_status: "usable", utc_instant: instant, local_timestamp: null });
const wall = (local: string): RecordTime => ({ timestamp_kind: "wall_clock", timestamp_status: "usable", utc_instant: null, local_timestamp: local });
const without = (status: "missing" | "invalid"): RecordTime => ({ timestamp_kind: "utc_instant", timestamp_status: status, utc_instant: null, local_timestamp: null });

describe("the time of a record", () => {
  it("is read to the microsecond, and a missing or unreadable time is no time", () => {
    expect(microsecondsOf(at("1970-01-01T00:00:01Z"))).toBe(BigInt(1_000_000));
    expect(microsecondsOf(at("1970-01-01T00:00:00.000001Z"))).toBe(BigInt(1));
    expect(microsecondsOf(at("1970-01-01T00:00:00.5Z"))).toBe(BigInt(500_000));
    expect(Number(microsecondsOf(at("2026-04-04T07:30:00Z"))! - microsecondsOf(at("2026-04-03T06:00:00Z"))!)).toBe(25.5 * HOUR);
    // Far from 1970 a floating-point number of microseconds no longer tells two neighbouring microseconds apart; the exact one does.
    expect(microsecondsOf(at("2500-01-01T00:00:00.000001Z"))! - microsecondsOf(at("2500-01-01T00:00:00.000000Z"))!).toBe(BigInt(1));
    expect(microsecondsOf(without("missing"))).toBeNull();
    expect(microsecondsOf(without("invalid"))).toBeNull();
  });

  it("reads a wall-clock time as it is written, whatever the zone of the browser", () => {
    expect(microsecondsOf(wall("1970-01-01T01:00:00"))).toBe(BigInt(HOUR));
    // In a zone with daylight saving this hour of the night does not exist; as recorded it is one hour after 01:30.
    expect(Number(microsecondsOf(wall("2026-03-29T02:30:00"))! - microsecondsOf(wall("2026-03-29T01:30:00"))!)).toBe(HOUR);
  });

  it("does not read a text that is no day of the calendar or no time of the day", () => {
    expect(microsecondsOf(at("2026-02-30T00:00:00Z"))).toBeNull();
    expect(microsecondsOf(at("2026-04-03T24:00:00Z"))).toBeNull();
    expect(microsecondsOf(at("03.04.2026 08:00"))).toBeNull();
  });
});

describe("the marks of the strip", () => {
  it("places one mark per distinct time linearly between the earliest and the latest", () => {
    const { strip, untimedCount, clock } = timelineOf([at("2026-04-03T06:00:00Z"), at("2026-04-03T07:00:00Z"), at("2026-04-03T10:00:00Z")], true);
    expect(clock).toBe("utc_instant");
    expect(untimedCount).toBe(0);
    expect(strip.kind).toBe("axis");
    if (strip.kind !== "axis") return;
    expect(strip.microseconds).toBe(4 * HOUR);
    expect(strip.marks.map((mark) => mark.position)).toEqual([0, 0.25, 1]);
    expect(strip.marks.map((mark) => mark.records)).toEqual([[0], [1], [2]]);
  });

  it("keeps records at exactly the same time on one mark, and apart when they differ by a microsecond", () => {
    const { strip } = timelineOf(
      [at("2026-04-03T06:00:00Z"), at("2026-04-03T06:00:00.000Z"), at("2026-04-03T06:00:00.000001Z"), at("2026-04-03T08:00:00Z"), at("2026-04-03T08:00:00Z")],
      true,
    );
    expect(strip.kind).toBe("axis");
    if (strip.kind !== "axis") return;
    expect(strip.marks.map((mark) => mark.records)).toEqual([[0, 1], [2], [3, 4]]);
    expect(strip.marks[0].position).toBe(0);
    expect(strip.marks[1].position).toBe(1 / (2 * HOUR));
    expect(strip.marks[2].position).toBe(1);
  });

  it("leaves records without a readable time off the strip and counts them", () => {
    const { strip, untimedCount } = timelineOf([at("2026-04-03T06:00:00Z"), without("missing"), at("2026-04-03T08:00:00Z"), without("invalid")], false);
    expect(untimedCount).toBe(2);
    expect(strip.kind).toBe("axis");
    if (strip.kind !== "axis") return;
    expect(strip.marks.map((mark) => mark.records)).toEqual([[0], [2]]);
    expect(strip.microseconds).toBe(2 * HOUR);
  });

  it("has no axis when every readable time is the same one", () => {
    const { strip, untimedCount } = timelineOf([at("2026-04-03T06:00:00Z"), at("2026-04-03T06:00:00Z"), without("missing")], false);
    expect(untimedCount).toBe(1);
    expect(strip).toEqual({ kind: "one_time", mark: { time: microsecondsOf(at("2026-04-03T06:00:00Z")), position: 0, records: [0, 1] } });
  });

  it("has no axis for one record, and none when no record has a readable time", () => {
    const one = timelineOf([at("2026-04-03T06:00:00Z")], true);
    expect(one.strip.kind).toBe("one_time");
    expect(one.gaps).toEqual([{ kind: "first" }]);
    expect(one.longest).toBeNull();
    const none = timelineOf([without("invalid"), without("missing")], false);
    expect(none.strip).toEqual({ kind: "no_time" });
    expect(none.clock).toBeNull();
    expect(none.untimedCount).toBe(2);
  });

  it("places the marks by time while the records of a mark keep the order of the list", () => {
    // An order by time is the local service's; were it another one, the strip would still be linear in time.
    const { strip } = timelineOf([at("2026-04-03T08:00:00Z"), at("2026-04-03T06:00:00Z"), at("2026-04-03T08:00:00Z")], true);
    if (strip.kind !== "axis") throw new Error("an axis is expected");
    expect(strip.marks.map((mark) => mark.records)).toEqual([[1], [0, 2]]);
  });
});

describe("the gaps of an incident", () => {
  it("are the plain differences between each record and the record before it", () => {
    const { gaps, withheld } = timelineOf([at("2026-04-03T06:00:00Z"), at("2026-04-03T06:00:00Z"), at("2026-04-03T06:30:00Z"), at("2026-04-04T08:00:00Z")], true);
    expect(withheld).toBeNull();
    expect(gaps).toEqual([
      { kind: "first" },
      { kind: "elapsed", microseconds: 0 },
      { kind: "elapsed", microseconds: 0.5 * HOUR },
      { kind: "elapsed", microseconds: 25.5 * HOUR },
    ]);
  });

  it("names the longest gap with the two records it lies between", () => {
    const { longest } = timelineOf([at("2026-04-03T06:00:00Z"), at("2026-04-03T07:00:00Z"), at("2026-04-03T10:00:00Z"), at("2026-04-03T12:00:00Z")], true);
    expect(longest).toEqual({ from: 1, to: 2, microseconds: 3 * HOUR, equalCount: 1 });
  });

  it("names the first in the declared order of equal longest gaps", () => {
    const { longest } = timelineOf(
      [at("2026-04-03T06:00:00Z"), at("2026-04-03T07:00:00Z"), at("2026-04-03T10:00:00Z"), at("2026-04-03T11:00:00Z"), at("2026-04-03T14:00:00Z")],
      true,
    );
    expect(longest).toEqual({ from: 1, to: 2, microseconds: 3 * HOUR, equalCount: 2 });
  });

  it("names the first gap of zero as the longest when every record carries the same time", () => {
    const { gaps, longest } = timelineOf([at("2026-04-03T06:00:00Z"), at("2026-04-03T06:00:00Z"), at("2026-04-03T06:00:00Z")], true);
    expect(gaps).toEqual([{ kind: "first" }, { kind: "elapsed", microseconds: 0 }, { kind: "elapsed", microseconds: 0 }]);
    // A gap of zero is a computed gap and is not the same as no gap: one record, or an order that cannot be evaluated, has none.
    expect(longest).toEqual({ from: 0, to: 1, microseconds: 0, equalCount: 2 });
    expect(timelineOf([at("2026-04-03T06:00:00Z")], true).longest).toBeNull();
  });

  it("keeps two times a microsecond apart as two times in a far year", () => {
    const { strip, gaps, longest } = timelineOf([at("2500-01-01T00:00:00.000000Z"), at("2500-01-01T00:00:00.000001Z")], true);
    expect(strip.kind).toBe("axis");
    expect(strip.kind === "axis" && [strip.microseconds, strip.marks.map((mark) => mark.position)]).toEqual([1, [0, 1]]);
    expect(gaps).toEqual([{ kind: "first" }, { kind: "elapsed", microseconds: 1 }]);
    expect(longest).toEqual({ from: 0, to: 1, microseconds: 1, equalCount: 1 });
  });

  it("names the places of the records without a readable time", () => {
    const { untimed, untimedCount } = timelineOf([at("2026-04-03T06:00:00Z"), without("invalid"), at("2026-04-03T07:00:00Z"), without("missing")], true);
    expect(untimed).toEqual([1, 3]);
    expect(untimedCount).toBe(2);
  });

  it("computes no gap at all when the local service says the order cannot be evaluated", () => {
    const { gaps, longest, withheld, strip } = timelineOf([at("2026-04-03T06:00:00Z"), at("2026-04-04T07:30:00Z"), without("invalid")], false);
    expect(withheld).toBe("order");
    expect(gaps).toEqual([]);
    expect(longest).toBeNull();
    // The times of the timed records are still what they are, so the strip stays.
    expect(strip.kind).toBe("axis");
  });

  it("computes no gap when the order cannot be evaluated although every time is readable", () => {
    const { gaps, longest, withheld } = timelineOf([at("2026-04-03T06:00:00Z"), at("2026-04-04T07:30:00Z")], false);
    expect(withheld).toBe("order");
    expect(gaps).toEqual([]);
    expect(longest).toBeNull();
  });

  it("computes no gap to or from a record without a readable time, and none across it", () => {
    const { gaps, longest } = timelineOf(
      [at("2026-04-03T06:00:00Z"), at("2026-04-03T07:00:00Z"), without("invalid"), without("missing"), at("2026-04-05T07:00:00Z"), at("2026-04-05T07:30:00Z")],
      true,
    );
    expect(gaps).toEqual([
      { kind: "first" },
      { kind: "elapsed", microseconds: HOUR },
      { kind: "untimed", record: "this" },
      { kind: "untimed", record: "this" },
      { kind: "untimed", record: "before" },
      { kind: "elapsed", microseconds: 0.5 * HOUR },
    ]);
    // The two days around the records without a time are no gap between two consecutive records.
    expect(longest).toEqual({ from: 0, to: 1, microseconds: HOUR, equalCount: 1 });
  });

  it("says that a record lies before the record before it and counts no gap for it", () => {
    const { gaps, longest } = timelineOf([at("2026-04-03T06:00:00Z"), at("2026-04-03T09:00:00Z"), at("2026-04-03T07:00:00Z"), at("2026-04-03T07:30:00Z")], true);
    expect(gaps[2]).toEqual({ kind: "earlier", microseconds: 2 * HOUR });
    expect(longest).toEqual({ from: 0, to: 1, microseconds: 3 * HOUR, equalCount: 1 });
  });

  it("takes the differences of wall-clock times on the recorded clock", () => {
    const { clock, gaps } = timelineOf([wall("2026-03-29T01:30:00"), wall("2026-03-29T03:30:00")], true);
    expect(clock).toBe("wall_clock");
    expect(gaps[1]).toEqual({ kind: "elapsed", microseconds: 2 * HOUR });
  });

  it("compares no UTC instant with a wall-clock time", () => {
    expect(timelineOf([at("2026-04-03T06:00:00Z"), wall("2026-04-03T08:00:00")], true)).toEqual({
      clock: null,
      strip: { kind: "two_clocks" },
      untimedCount: 0,
      untimed: [],
      withheld: "clocks",
      gaps: [],
      longest: null,
    });
  });

  it("leaves the records as they are given", () => {
    const records = [at("2026-04-03T08:00:00Z"), without("invalid"), at("2026-04-03T06:00:00Z")];
    const copy = structuredClone(records);
    timelineOf(records, true);
    expect(records).toEqual(copy);
  });
});
