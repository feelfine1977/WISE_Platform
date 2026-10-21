import { describe, expect, it } from "vitest";
import { identity, workspaceId } from "../test/imports";
import { scoringRefusal } from "../test/scoring";
import { contractMethodBuild, scoringContract } from "./client";

const request = { request_id: "score-2", query_revision: 2, workspace_id: workspaceId };

function refusal(caseIds: string[]) {
  const outcome = scoringRefusal(request, "score_expectation", "unevaluable_sequence", "The order cannot be evaluated.", caseIds);
  if (outcome.ok || outcome.problem.kind !== "refusal") throw new Error("A refusal was written.");
  return outcome.problem.refusal;
}

describe("the scoring contract in the browser", () => {
  it("holds a refusal for an unevaluable sequence to naming its cases and a way out", () => {
    expect(scoringContract.refusal(refusal(["E-5"]))).toBe(true);
    expect(scoringContract.refusal(refusal([]))).toBe(false);
    expect(scoringContract.refusal({ ...refusal(["E-5"]), recovery_actions: ["retry"] })).toBe(false);
    expect(scoringContract.refusal({ ...refusal(["E-5", "E-5"]), case_count: 2 })).toBe(false);
  });

  it("holds a validation answer to the parts its state requires", () => {
    const blocked = {
      schema_version: 1,
      message_type: "expectation_validation_answer",
      ...request,
      state: "blocked",
      definition_version: null,
      readiness: {
        method_artifact: {
          distribution: "wise-pm",
          version: "0.2.0",
          source_commit: contractMethodBuild.sourceCommit,
          wheel_sha256: "7329b7929bb8a3e40c596b359f352aace23cc233d8f29322ee063612733aecc3",
          qualification: "candidate_component_checked_release_pending",
          eligible_release: false,
        },
        supported_definition: false,
        preparation_gate_passed: true,
        method_check_passed: false,
        release_gate_pending: true,
      },
      blockers: [],
    };
    expect(scoringContract.validationAnswer(blocked)).toBe(false);
    const blocker = { code: "clock_mismatch", field: "definition.clock_kind", message: "Another clock.", case_ids: [], case_count: 0, recovery_actions: ["edit_definition"] };
    expect(scoringContract.validationAnswer({ ...blocked, blockers: [blocker] })).toBe(true);
    expect(scoringContract.validationAnswer({ ...blocked, blockers: [blocker], state: "ready" })).toBe(false);
  });

  it("names the one build of the method library the contract admits", () => {
    expect(contractMethodBuild).toEqual({ distribution: "wise-pm", version: "0.2.0", sourceCommit: "6883db5269e622d9ce5274d207e831d12ab134fe", eligibleRelease: false });
    expect(identity.population_id).toMatch(/^population\.v1:sha256:/);
  });
});
