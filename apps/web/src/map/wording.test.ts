import { describe, expect, it } from "vitest";
import { begins, contains, ends, follows, followingOpened, parent, suppliedGraph, support } from "../test/selections";
import { activityTimeLines, boundaryLine, coverageRows, lagLine, mapCaption, nameContextColumns, overlapLine, stepCounts, stepWording } from "./wording";

describe("the words of a step", () => {
  it("says what each kind of step keeps", () => {
    expect(stepWording(contains("Eröffnet"))).toBe("Keep incidents that contain “Eröffnet”");
    expect(stepWording(contains("Eröffnet", true))).toBe("Keep incidents that do not contain “Eröffnet”");
    expect(stepWording(follows("Eröffnet", "Geschlossen"))).toBe("Keep incidents where “Geschlossen” directly follows “Eröffnet”");
    expect(stepWording(follows("Eröffnet", "Geschlossen", true))).toBe("Keep incidents where “Geschlossen” never directly follows “Eröffnet”");
    expect(stepWording(begins("Eröffnet"))).toBe("Keep incidents that begin with “Eröffnet”");
    expect(stepWording(begins("Eröffnet", true))).toBe("Keep incidents that do not begin with “Eröffnet”");
    expect(stepWording(ends("Geschlossen"))).toBe("Keep incidents that end with “Geschlossen”");
    expect(stepWording(ends("Geschlossen", true))).toBe("Keep incidents that do not end with “Geschlossen”");
  });

  it("names a missing opening value as missing and the text Unknown as a value", () => {
    const anchor = "incident.context.first_record_in_declared_order.v1" as const;
    expect(stepWording({ kind: "opening_attribute_equals", column_index: 3, value: null, negate: false, anchor_policy: anchor })).toBe(
      "Keep incidents whose first record has no value in column 3",
    );
    expect(stepWording({ kind: "opening_attribute_equals", column_index: 3, value: "Unknown", negate: true, anchor_policy: anchor })).toBe(
      "Keep incidents whose first record does not have the value “Unknown” in column 3",
    );
  });

  it("shows the step's own supplied kept, removed and unevaluable incidents and records", () => {
    expect(stepCounts({ predicate: follows("Eröffnet", "Geschlossen"), ...followingOpened.results[0] })).toEqual([
      ["Kept", "1 incident · 2 records"],
      ["Removed", "0 incidents · 0 records"],
      ["Not evaluable", "1 incident · 1 record"],
    ]);
    expect(stepCounts({ predicate: contains("X"), kept: support([], 0), removed: support(["A", "B"], 12345), unevaluable: support([], 0) })[1]).toEqual([
      "Removed",
      "2 incidents · 12,345 records",
    ]);
  });

  it("says that the removals of the steps overlap and do not add up", () => {
    expect(overlapLine(parent)).toBe(
      "Each step is counted on its own over all 2 incidents of the parent. " +
        "An incident that several steps remove is counted by each of them, so the removals overlap and do not add up.",
    );
  });
});

describe("the words of the map", () => {
  it("says over which incidents activities and paths are counted, and what is not evaluable", () => {
    expect(mapCaption(suppliedGraph(["A-1", "B-2"]).meta)).toEqual([
      "Activities count labelled records and distinct incidents of the 2 incidents on the map.",
      "Paths count passages and distinct incidents of the 1 incident whose order of records can be evaluated.",
      "1 incident with 1 record is not evaluable for paths; 0 records have no activity label.",
      "Observed labelled starts and ends: an incident starts or ends at an activity only when its first or last record carries that label.",
      "Start and End are added by the map: a flow leaves Start for every activity incidents begin with and enters End from every activity they end with, each with that number of incidents. They are always shown.",
      "Lag: the median of elapsed hours between the two records of a path.",
    ]);
  });

  it("says how many incidents begin or end with the activity of a flow from Start or to End", () => {
    expect(boundaryLine("start", "Eröffnet", 1)).toBe("1 incident on the map begins with “Eröffnet”.");
    expect(boundaryLine("start", "Eröffnet", 12345)).toBe("12,345 incidents on the map begin with “Eröffnet”.");
    expect(boundaryLine("end", "Geschlossen", 1)).toBe("1 incident on the map ends with “Geschlossen”.");
    expect(boundaryLine("end", "Geschlossen", 2)).toBe("2 incidents on the map end with “Geschlossen”.");
  });

  it("says the two times of an activity in hours below two days and in days from there on, with their passages", () => {
    expect(activityTimeLines({ medianPreviousHours: 1.5, usablePreviousCount: 4, medianNextHours: 60, usableNextCount: 1 })).toEqual([
      "Time since the event before: median 1.5 hours over 4 passages into this activity.",
      "Time until the next event: median 2.5 days over 1 passage out of this activity.",
    ]);
    // Up to 48 hours a time is said in hours, 48 hours are two days; every time has one decimal.
    const before = (hours: number) => activityTimeLines({ medianPreviousHours: hours, usablePreviousCount: 12345, usableNextCount: 0 })[0];
    expect(before(0)).toBe("Time since the event before: median 0.0 hours over 12,345 passages into this activity.");
    expect(before(1)).toBe("Time since the event before: median 1.0 hours over 12,345 passages into this activity.");
    expect(before(25.5)).toBe("Time since the event before: median 25.5 hours over 12,345 passages into this activity.");
    expect(before(47.94)).toBe("Time since the event before: median 47.9 hours over 12,345 passages into this activity.");
    expect(before(48)).toBe("Time since the event before: median 2.0 days over 12,345 passages into this activity.");
    expect(before(1000)).toBe("Time since the event before: median 41.7 days over 12,345 passages into this activity.");
  });

  it("says that a time of an activity is not available where no path leads into or out of it", () => {
    expect(activityTimeLines({ usablePreviousCount: 0, medianNextHours: 25.5, usableNextCount: 1 })).toEqual([
      "Time since the event before: not available; no path leads into this activity.",
      "Time until the next event: median 25.5 hours over 1 passage out of this activity.",
    ]);
    expect(activityTimeLines({ usablePreviousCount: 0, usableNextCount: 0 })).toEqual([
      "Time since the event before: not available; no path leads into this activity.",
      "Time until the next event: not available; no path leads out of this activity.",
    ]);
  });

  it("names a lag of the recorded wall clock with its limitation", () => {
    const meta = {
      ...suppliedGraph(["A-1"]).meta,
      timestamp_kind: "wall_clock" as const,
      lag_clock: "recorded_wall_clock_hours" as const,
      clock_limitation: "Recorded wall-clock differences may differ from physical elapsed time across clock changes.",
    };
    expect(lagLine(meta)).toBe(
      "Lag: the median of hours of the recorded wall clock between the two records of a path. " +
        "Recorded wall-clock differences may differ from physical elapsed time across clock changes.",
    );
    expect(coverageRows(meta)).toContainEqual(["Lag", "hours of the recorded wall clock"]);
  });
});

describe("a step on a context column", () => {
  const step = { kind: "opening_attribute_equals", column_index: 11, value: "Medium", negate: false, anchor_policy: "incident.context.first_record_in_declared_order.v1" } as const;

  it("names the column by its name once the reading's names are known, and by its place before", () => {
    expect(stepWording(step)).toBe("Keep incidents whose first record has the value “Medium” in column 11");
    nameContextColumns(new Map([[11, "impact"]]));
    try {
      expect(stepWording(step)).toBe("Keep incidents whose first record has the value “Medium” in the column “impact”");
      expect(stepWording({ ...step, column_index: 3, negate: true })).toBe("Keep incidents whose first record does not have the value “Medium” in column 3");
    } finally {
      nameContextColumns(new Map());
    }
  });
});
