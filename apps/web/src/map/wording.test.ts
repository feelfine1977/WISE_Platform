import { describe, expect, it } from "vitest";
import { begins, contains, ends, follows, followingOpened, parent, suppliedGraph, support } from "../test/selections";
import { boundaryLine, coverageRows, flowsLine, lagLine, mapCaption, nameContextColumns, overlapLine, stepCounts, stepWording } from "./wording";

describe("the words of a step", () => {
  it("name up to five case numbers each, and a longer list by its count and its first three", () => {
    expect(stepWording({ kind: "case_id_in", case_ids: ["A-1", "B-2"], negate: false })).toBe("Keep cases with these exact numbers: “A-1”, “B-2”");
    const many = Array.from({ length: 1196 }, (_, place) => `I-${place}`);
    expect(stepWording({ kind: "case_id_in", case_ids: [many[0], ...many.slice(1)], negate: true })).toBe(
      "Keep cases outside the 1,196 exact numbers: “I-0”, “I-1”, “I-2” and 1,193 more",
    );
  });

  it("says what each kind of step keeps", () => {
    expect(stepWording(contains("Eröffnet"))).toBe("Keep cases that contain “Eröffnet”");
    expect(stepWording(contains("Eröffnet", true))).toBe("Keep cases that do not contain “Eröffnet”");
    expect(stepWording(follows("Eröffnet", "Geschlossen"))).toBe("Keep cases where “Geschlossen” directly follows “Eröffnet”");
    expect(stepWording(follows("Eröffnet", "Geschlossen", true))).toBe("Keep cases where “Geschlossen” never directly follows “Eröffnet”");
    expect(stepWording(begins("Eröffnet"))).toBe("Keep cases that begin with “Eröffnet”");
    expect(stepWording(begins("Eröffnet", true))).toBe("Keep cases that do not begin with “Eröffnet”");
    expect(stepWording(ends("Geschlossen"))).toBe("Keep cases that end with “Geschlossen”");
    expect(stepWording(ends("Geschlossen", true))).toBe("Keep cases that do not end with “Geschlossen”");
  });

  it("names a missing opening value as missing and the text Unknown as a value", () => {
    const anchor = "incident.context.first_record_in_declared_order.v1" as const;
    expect(stepWording({ kind: "opening_attribute_equals", column_index: 3, value: null, negate: false, anchor_policy: anchor })).toBe(
      "Keep cases whose first record has no value in column 3 (its name is not known)",
    );
    expect(stepWording({ kind: "opening_attribute_equals", column_index: 3, value: "Unknown", negate: true, anchor_policy: anchor })).toBe(
      "Keep cases whose first record does not have the value “Unknown” in column 3 (its name is not known)",
    );
  });

  it("shows the step's own supplied kept, removed and unevaluable cases and records", () => {
    expect(stepCounts({ predicate: follows("Eröffnet", "Geschlossen"), ...followingOpened.results[0] })).toEqual([
      ["Kept", "1 case · 2 records"],
      ["Removed", "0 cases · 0 records"],
      ["Not evaluable", "1 case · 1 record"],
    ]);
    expect(stepCounts({ predicate: contains("X"), kept: support([], 0), removed: support(["A", "B"], 12345), unevaluable: support([], 0) })[1]).toEqual([
      "Removed",
      "2 cases · 12,345 records",
    ]);
  });

  it("says that the removals of the steps overlap and do not add up", () => {
    expect(overlapLine(parent)).toBe(
      "Each step is counted on its own over all 2 cases of the parent. " +
        "A case that several steps remove is counted by each of them, so the removals overlap and do not add up.",
    );
  });
});

describe("the words of the map", () => {
  it("says over which cases activities and paths are counted, and what is not evaluable", () => {
    expect(mapCaption(suppliedGraph(["A-1", "B-2"]).meta)).toEqual([
      "Activities count labelled records and distinct cases of the 2 cases on the map.",
      "Paths count passages and distinct cases of the 1 case whose order of records can be evaluated.",
      "1 case with 1 record is not evaluable for paths; 0 records have no activity label.",
      "Observed labelled starts and ends: a case starts or ends at an activity only when its first or last record carries that label.",
      "Start and End are added by the map: a flow leaves Start for an activity cases begin with and enters End from an activity they end with, each with that number of cases. Start and End are always shown, each with the strongest flow among the activities shown. The Paths detail ranks the paths by their cases; another flow is drawn when it carries at least as many cases as the weakest path drawn by frequency, and all are drawn when every path is; the menu of an activity offers the cases that begin or end with it also while its flow is not drawn.",
      "Lag: the median of elapsed hours between the two records of a path.",
      "Measures: the legend under the map, shown whole, switches what the map writes. " +
        "Frequency: the cases on every path and activity. " +
        "Performance: before the cases of a path its median lag, and on an activity the median time until the next event, with “–” where none is available; " +
        "the time since the event before is said under the map for a selected activity. " +
        "Shortfall has no values here: no expectation results are supplied to the map.",
    ]);
  });

  it("says how many cases begin or end with the activity of a flow from Start or to End", () => {
    expect(boundaryLine("start", "Eröffnet", 1)).toBe("1 case on the map begins with “Eröffnet”.");
    expect(boundaryLine("start", "Eröffnet", 12345)).toBe("12,345 cases on the map begin with “Eröffnet”.");
    expect(boundaryLine("end", "Geschlossen", 1)).toBe("1 case on the map ends with “Geschlossen”.");
    expect(boundaryLine("end", "Geschlossen", 2)).toBe("2 cases on the map end with “Geschlossen”.");
    // Flows that are not drawn are said with the map's own numbers; nothing is said while all are drawn.
    expect(flowsLine({ flows: 44, drawn: 44 }, 0)).toBeNull();
    expect(flowsLine({ flows: 44, drawn: 20 }, 254)).toBe(
      "Not drawn at this detail: 24 of the 44 flows from Start and to End, each with fewer than 254 cases. The Paths slider draws more.",
    );
    expect(flowsLine({ flows: 3, drawn: 2 }, 1)).toBe("Not drawn at this detail: 1 of the 3 flows from Start and to End, with fewer than 1 case. The Paths slider draws more.");
    expect(flowsLine({ flows: 5, drawn: 2 }, Number.POSITIVE_INFINITY)).toBe("Not drawn at this detail: 3 of the 5 flows from Start and to End. The Paths slider draws more.");
    // A flow of an activity the detail does not show is not drawn either, and is said apart from the weak ones.
    expect(flowsLine({ flows: 44, drawn: 18, unshown: 4 }, 373)).toBe(
      "Not drawn at this detail: 26 of the 44 flows from Start and to End: 4 of activities that are not shown, 22 with fewer than 373 cases. The sliders draw more.",
    );
    expect(flowsLine({ flows: 6, drawn: 4, unshown: 2 }, 0)).toBe(
      "Not drawn at this detail: 2 of the 6 flows from Start and to End, of activities that are not shown. The Activities slider shows more.",
    );
    expect(flowsLine({ flows: 6, drawn: 6, unshown: 0 }, 0)).toBeNull();
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
    expect(stepWording(step)).toBe("Keep cases whose first record has the value “Medium” in column 11 (its name is not known)");
    nameContextColumns(new Map([[11, "impact"]]));
    try {
      expect(stepWording(step)).toBe("Keep cases whose first record has the value “Medium” in the column “impact”");
      expect(stepWording({ ...step, column_index: 3, negate: true })).toBe("Keep cases whose first record does not have the value “Medium” in column 3 (its name is not known)");
    } finally {
      nameContextColumns(new Map());
    }
  });
});
