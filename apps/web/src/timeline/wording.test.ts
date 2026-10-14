import { describe, expect, it } from "vitest";
import { stripOf } from "./timeline";
import {
  basisLine,
  elapsedText,
  gapLine,
  longestGapWords,
  markLabel,
  noAxisLine,
  recordName,
  STRIP_HINT,
  timeText,
  UNTIMED_SHOWN,
  untimedLine,
  untimedRest,
  withheldLine,
} from "./wording";

const SECOND = 1_000_000;
const HOUR = 3600 * SECOND;

const opened = { activity: "Eröffnet", source_position: 0, timestamp_kind: "utc_instant", timestamp_status: "usable", utc_instant: "2026-04-03T06:00:00Z", local_timestamp: null } as const;
const unlabelled = { ...opened, activity: null, source_position: 1, utc_instant: "2026-04-04T07:30:00Z" } as const;
const recorded = { ...opened, timestamp_kind: "wall_clock", utc_instant: null, local_timestamp: "2026-04-03T08:00:00" } as const;

describe("a difference of two recorded times in words", () => {
  it("is said in hours below 48 hours and in days from there on, as the map says its times", () => {
    expect(elapsedText(HOUR)).toBe("1.0 hours");
    expect(elapsedText(25.5 * HOUR)).toBe("25.5 hours");
    expect(elapsedText(47.9 * HOUR)).toBe("47.9 hours");
    expect(elapsedText(48 * HOUR)).toBe("2.0 days");
    expect(elapsedText(36 * 24 * HOUR)).toBe("36.0 days");
    expect(elapsedText(1234.5 * 24 * HOUR)).toBe("1,234.5 days");
  });

  it("is said in minutes below one hour and in seconds below one minute", () => {
    expect(elapsedText(0.5 * HOUR)).toBe("30.0 minutes");
    expect(elapsedText(90 * SECOND)).toBe("1.5 minutes");
    expect(elapsedText(60 * SECOND)).toBe("1.0 minutes");
    expect(elapsedText(45 * SECOND)).toBe("45.0 seconds");
    expect(elapsedText(0.25 * SECOND)).toBe("0.3 seconds");
  });

  it("does not write a difference that is there as none", () => {
    expect(elapsedText(1)).toBe("less than 0.1 seconds");
    expect(elapsedText(0.049 * SECOND)).toBe("less than 0.1 seconds");
    expect(elapsedText(0.05 * SECOND)).toBe("0.1 seconds");
    expect(elapsedText(0)).toBe("0.0 seconds");
  });
});

describe("the words of the strip", () => {
  it("writes a time as the list writes it", () => {
    expect(timeText(opened)).toBe("2026-04-03 06:00:00 UTC");
    expect(timeText(recorded)).toBe("2026-04-03 08:00:00 as recorded");
  });

  it("says of a mark its time, how far it lies from the earliest, and its records", () => {
    expect(markLabel("2026-04-03 06:00:00 UTC", 2, 0)).toBe("2026-04-03 06:00:00 UTC, the earliest recorded time: 2 records");
    expect(markLabel("2026-04-04 07:30:00 UTC", 1, 25.5 * HOUR)).toBe("2026-04-04 07:30:00 UTC, 25.5 hours after the earliest recorded time: 1 record");
  });

  it("counts the records that are on no mark", () => {
    expect(untimedLine(1)).toBe("1 record without a readable time is not on the strip.");
    expect(untimedLine(2)).toBe("2 records without a readable time are not on the strip.");
    // Only so many of them are offered by name under the strip; the others are said to be in the list.
    expect(untimedRest(UNTIMED_SHOWN)).toBeNull();
    expect(untimedRest(UNTIMED_SHOWN + 1)).toBe("and 1 more record in the list below");
    expect(untimedRest(UNTIMED_SHOWN + 3)).toBe("and 3 more records in the list below");
  });

  it("says in place of the axis why there is none", () => {
    const time = "2026-04-03 06:00:00 UTC";
    // The supplied times of the records, the one at six o'clock as 1, a record without a usable time as null.
    const sentence = (times: (bigint | null)[]) => {
      const strip = stripOf(times);
      if (strip.kind === "axis") throw new Error("no axis is expected");
      return noAxisLine(strip, times.length, time);
    };
    expect(sentence([1n])).toBe("This incident has one record, at 2026-04-03 06:00:00 UTC; there is no elapsed time to draw.");
    expect(sentence([1n, 1n, 1n])).toBe("All 3 records of this incident carry the same recorded time, 2026-04-03 06:00:00 UTC; there is no elapsed time to draw.");
    expect(sentence([1n, 1n])).toBe("Both records of this incident carry the same recorded time, 2026-04-03 06:00:00 UTC; there is no elapsed time to draw.");
    expect(sentence([1n, null, null])).toBe(
      "Only one of the 3 records of this incident has a readable time, 2026-04-03 06:00:00 UTC; there is no elapsed time to draw.",
    );
    expect(sentence([1n, 1n, null])).toBe(
      "The 2 records with a readable time carry the same recorded time, 2026-04-03 06:00:00 UTC, and 1 record has no readable time; there is no elapsed time to draw.",
    );
    expect(sentence([null, null])).toBe("No record of this incident has a readable time; there is no elapsed time to draw.");
    expect(noAxisLine({ kind: "not_supplied", reason: "omitted" }, 3, "")).toBe(
      "Time diagnostics were not supplied for this incident, so no elapsed time is drawn or computed here.",
    );
    expect(noAxisLine({ kind: "not_supplied", reason: "mismatch" }, 3, "")).toBe("The time diagnostics do not match the records of this incident, so no elapsed time is drawn.");
  });
});

describe("the words of the gaps", () => {
  it("says the gap before a record, and nothing before the first record", () => {
    expect(gapLine({ kind: "first" })).toBeNull();
    expect(gapLine({ kind: "elapsed", exact: BigInt(25.5 * HOUR), microseconds: 25.5 * HOUR })).toBe("Gap since the record before: 25.5 hours");
    expect(gapLine({ kind: "elapsed", exact: 0n, microseconds: 0 })).toBe("Gap since the record before: none, the same recorded time");
  });

  it("says why no gap is given", () => {
    expect(withheldLine()).toBe(
      "No gap is given for this incident: the local service says that the order of its records cannot be evaluated, so it is not known which record follows which.",
    );
  });

  it("names a record by its activity, its time and its place in the source", () => {
    expect(recordName(opened)).toBe("“Eröffnet” (2026-04-03 06:00:00 UTC, source position 0)");
    expect(recordName(unlabelled)).toBe("a record without activity label (2026-04-04 07:30:00 UTC, source position 1)");
  });

  it("names the longest gap with the two records it lies between, and says when it is the first of equal ones", () => {
    expect(longestGapWords({ from: 0, to: 1, exact: BigInt(25.5 * HOUR), microseconds: 25.5 * HOUR, equalCount: 1 }, opened, unlabelled)).toEqual([
      "Longest gap: 25.5 hours",
      "between “Eröffnet” (2026-04-03 06:00:00 UTC, source position 0) and a record without activity label (2026-04-04 07:30:00 UTC, source position 1).",
    ]);
    expect(longestGapWords({ from: 0, to: 1, exact: BigInt(25.5 * HOUR), microseconds: 25.5 * HOUR, equalCount: 3 }, opened, unlabelled)[1]).toMatch(
      / It is the first of 3 gaps of this length in the declared order\.$/,
    );
  });

  it("says where the numbers come from, and what a recorded wall clock does not say", () => {
    const basis = "The elapsed times here are supplied by the local service, exactly to the microsecond, from every record in the declared order.";
    expect(basisLine({ clock: "utc_instant" })).toBe(basis);
    expect(basisLine({ clock: "wall_clock" })).toBe(
      `${basis} The times are wall-clock times as recorded; across a clock change a difference may differ from the physical elapsed time.`,
    );
  });
});

describe("the words of the timeline as a whole", () => {
  const sources = import.meta.glob<string>(["./*.{ts,tsx}", "!./*.test.{ts,tsx}"], { query: "?raw", import: "default", eager: true });

  it("claim nothing the log does not say: no word for an end of an incident or for a judgement of its time", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(2);
    const claims = /\b(?:wait\w*|delay\w*|resolv\w*|late|lateness|overdue|slow\w*|stuck|idle)\b/i;
    for (const [file, source] of Object.entries(sources)) expect(source.match(claims), file).toBeNull();
    expect(STRIP_HINT).not.toMatch(claims);
  });
});
