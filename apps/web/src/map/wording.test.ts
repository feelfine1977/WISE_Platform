import { describe, expect, it } from "vitest";
import { contains, follows, followingOpened, parent, suppliedGraph, support } from "../test/selections";
import { coverageRows, lagLine, mapCaption, overlapLine, stepCounts, stepWording } from "./wording";

describe("the words of a step", () => {
  it("says what each kind of step keeps", () => {
    expect(stepWording(contains("Eröffnet"))).toBe("Keep incidents that contain “Eröffnet”");
    expect(stepWording(contains("Eröffnet", true))).toBe("Keep incidents that do not contain “Eröffnet”");
    expect(stepWording(follows("Eröffnet", "Geschlossen"))).toBe("Keep incidents where “Geschlossen” directly follows “Eröffnet”");
    expect(stepWording(follows("Eröffnet", "Geschlossen", true))).toBe("Keep incidents where “Geschlossen” never directly follows “Eröffnet”");
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
      "Lag: the median of elapsed hours between the two records of a path.",
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
