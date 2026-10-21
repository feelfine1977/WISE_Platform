import { describe, expect, it } from "vitest";
import type { ScoreExpectationRequest } from "../generated/scoring";
import { identity, workspaceId } from "../test/imports";
import { runAnswer, verdicts } from "../test/scoring";
import { definitionOf, emptyForm, formProblems, sameMeaning } from "./definition";
import { checkStateCounts, definitionSentence, inState, measurementText, methodLine, readHours, stateCounts, worstFirst } from "./wording";

const form = { ...emptyForm, name: "Closed within four hours", owner: "Service desk", sourceLabel: "Agreement 7", rationale: "Customers wait.", start: "Eröffnet", response: "Geschlossen", target: "4", width: "2" };
const request: ScoreExpectationRequest = {
  schema_version: 1,
  message_type: "score_expectation_request",
  request_id: "score-2",
  query_revision: 2,
  workspace_id: workspaceId,
  base_identity: identity,
  named_population: { name: "every case", identity },
  definition_version_id: `definition-version.v1:sha256:${"1".repeat(64)}`,
};

describe("the definition as one sentence", () => {
  it("names both activities, target, width and the meaning of a missing response", () => {
    expect(definitionSentence({ start: "Eröffnet", response: "Geschlossen", target: 4, width: 2, missing: "violate" })).toBe(
      "After “Eröffnet”, “Geschlossen” is recorded within 4 hours; up to 2 hours later the expectation is partly met, and after that it is not met. " +
        "A case with “Eröffnet” but no “Geschlossen” at or after it counts as not met. A case without “Eröffnet” gets no value.",
    );
    expect(definitionSentence({ start: "A", response: "B", target: 1, width: 0, missing: "skip" })).toBe(
      "After “A”, “B” is recorded within 1 hour; any later the expectation is not met. A case with “A” but no “B” at or after it gets no value. " +
        "A case without “A” gets no value.",
    );
  });

  it("reads hours with a decimal point or comma and nothing else", () => {
    expect([readHours("4"), readHours("4.5"), readHours("4,5"), readHours(" 8 ")]).toEqual([4, 4.5, 4.5, 8]);
    expect([readHours(""), readHours("-1"), readHours("1e3"), readHours("4 h"), readHours("Infinity")]).toEqual([null, null, null, null, null]);
  });
});

describe("the definition of the form", () => {
  it("is the contract's first-after definition in hours on the preparation's clock", () => {
    expect(definitionOf({ ...form, reviewed: true }, "wall_clock", 2)).toEqual({
      kind: "resolution_first_after.v1",
      name: "Closed within four hours",
      definition_revision: 2,
      review_state: "reviewed",
      provenance: { kind: "locally_entered", owner_label: "Service desk", source_label: "Agreement 7", rationale: "Customers wait." },
      role: "negotiable_target",
      scope: { kind: "all_cases" },
      endpoints: { activation_activity: "Eröffnet", response_activity: "Geschlossen", activation: "first", response: "first_after", response_time_comparison: "at_or_after" },
      clock_kind: "wall_clock",
      target: 4,
      width: 2,
      unit: "hours",
      missing_activation: "skip",
      missing_response: "violate",
      calibration: "fixed_threshold",
    });
  });

  it("is missing while a field is empty or a number unreadable, and says which", () => {
    expect(definitionOf({ ...form, target: "vier" }, "utc_instant", 1)).toBeNull();
    expect(formProblems({ ...form, owner: " ", width: "" }).map((problem) => problem.field)).toEqual(["owner", "width"]);
  });

  it("keeps its meaning when only the review mark or the revision number changes", () => {
    const draft = definitionOf(form, "utc_instant", 1)!;
    expect(sameMeaning(draft, definitionOf({ ...form, reviewed: true }, "utc_instant", 3)!)).toBe(true);
    expect(sameMeaning(draft, definitionOf({ ...form, width: "3" }, "utc_instant", 1)!)).toBe(false);
  });
});

describe("the states of a run", () => {
  const run = runAnswer(request, definitionOf(form, "utc_instant", 1)!).run;

  it("puts each case in the states its supplied value and measurement name", () => {
    const members = (state: Parameters<typeof inState>[1]) => verdicts.filter((verdict) => inState(verdict, state)).map((verdict) => verdict.case_id);
    expect(members("met")).toEqual(["A-1"]);
    expect(members("partly")).toEqual(["B-2"]);
    expect(members("not_met")).toEqual(["C-3", "D-4"]);
    expect(members("no_start")).toEqual(["E-5"]);
    expect(members("no_response")).toEqual(["D-4"]);
    expect(members("out_of_scope")).toEqual([]);
  });

  it("counts them from the run's support, splitting the affected cases into partly and not met", () => {
    expect(stateCounts(run)).toEqual({ met: 1, partly: 1, not_met: 2, out_of_scope: 0, scope_unknown: 0, no_start: 1, no_response: 1 });
    expect(checkStateCounts(run)).toBeNull();
    expect(checkStateCounts({ ...run, support: { ...run.support, affected_case_count: 2 } })).not.toBeNull();
    expect(checkStateCounts({ ...run, support: { ...run.support, zero_value_case_count: 0 } })).not.toBeNull();
  });

  it("lists the cases worst first and those without a value last, in the order supplied", () => {
    expect(worstFirst(verdicts).map((verdict) => verdict.case_id)).toEqual(["C-3", "D-4", "B-2", "A-1", "E-5"]);
  });

  it("writes a measured time, a missing endpoint and an open age", () => {
    expect(verdicts.map((verdict) => measurementText(verdict.measurement))).toEqual(["3 hours", "5 hours", "8 hours", "no response", "no start"]);
    expect(measurementText({ status: "missing_response", value: null, unit: "hours", activation_known: true, response_known: false, censor_age: 1 })).toBe(
      "no response; open 1 hour at the cutoff",
    );
  });
});

describe("the line about the method library", () => {
  it("names the library, its version and that it is an untagged state", () => {
    expect(methodLine({ distribution: "wise-pm", version: "0.2.0", sourceCommit: "6883db5269e622d9ce5274d207e831d12ab134fe", eligibleRelease: false })).toBe(
      "Scored by the method library wise-pm 0.2.0, built from source 6883db5: an untagged state, not a published release.",
    );
  });
});
