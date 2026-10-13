import { describe, expect, it } from "vitest";
import type { SavedComparison } from "../generated/saving";
import { identity, workspaceId } from "../test/imports";
import { groupAnswer, scriptedComparisonClient } from "../test/comparisons";
import { comparisonContract } from "./client";
import { type CompareBasis, CompareCoordinator } from "./coordinator";

const basis: CompareBasis = { workspaceId, identity, clock: "utc_instant", contextColumns: [3] };
const otherReading: CompareBasis = { ...basis, identity: { ...identity, preparation_id: `preparation.v1:sha256:${"9".repeat(64)}` } };

/** A saved comparison of two listed groups over a parent of three incidents, with the id its answer will carry. */
function savedComparison(comparisonId: string): SavedComparison {
  return {
    kind: "group",
    comparison_id: comparisonId,
    parent_case_ids: ["C-1", "C-2", "C-3"],
    context_column_index: 3,
    context_policy: "incident.context.first_record_in_declared_order.v1",
    definition: {
      mode: "two_named_groups",
      target: { name: "Early", definition: { kind: "explicit_case_ids", case_ids: ["C-1"] } },
      reference: { name: "Late", definition: { kind: "explicit_case_ids", case_ids: ["C-2", "C-3"] } },
    },
  };
}

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("showing the comparison of a reopened investigation again", () => {
  it("asks for the saved comparison exactly as saved once its reading is compared in, and shows its answer", async () => {
    const comparisons = scriptedComparisonClient();
    const coordinator = new CompareCoordinator(comparisons.client);
    const saved = savedComparison("pending");

    coordinator.restore(workspaceId, identity, saved);
    expect(comparisons.groups).toHaveLength(0);

    coordinator.useBasis(basis);
    expect(comparisons.groups).toHaveLength(1);
    const { request, reply } = comparisons.groups[0];
    expect(comparisonContract.groupRequest(request)).toBe(true);
    expect(request.parent_case_ids).toEqual(saved.parent_case_ids);
    expect(request.context_column_index).toBe(3);
    expect(request.context_policy).toBe(saved.context_policy);
    expect(request.definition).toEqual(saved.definition);
    expect(coordinator.getState().comparison.phase).toBe("loading");

    // The answer is the saved comparison only when it carries the saved comparison's id.
    const answer = groupAnswer(request);
    saved.comparison_id = answer.comparison_id;
    reply({ ok: true, answer });
    await settled();
    const shown = coordinator.getState().comparison;
    expect(shown.phase).toBe("ready");
    expect(shown.phase === "ready" && shown.shown.answer.comparison_id).toBe(answer.comparison_id);
    expect(coordinator.savedComparisonFor(workspaceId, identity)?.comparison_id).toBe(answer.comparison_id);
  });

  it("does not show an answer that is another comparison than the saved one, and asks again on retry", async () => {
    const comparisons = scriptedComparisonClient();
    const coordinator = new CompareCoordinator(comparisons.client);
    coordinator.useBasis(basis);
    coordinator.restore(workspaceId, identity, savedComparison(`comparison.v1:sha256:${"0".repeat(64)}`));
    const first = comparisons.groups[0];

    first.reply({ ok: true, answer: groupAnswer(first.request) });
    await settled();
    const failed = coordinator.getState().comparison;
    expect(failed.phase).toBe("failed");
    expect(failed.phase === "failed" && failed.shown).toBeNull();

    coordinator.retry();
    expect(comparisons.groups).toHaveLength(2);
    expect(comparisons.groups[1].request.definition).toEqual(first.request.definition);
  });

  it("forgets a saved comparison when another reading is compared in, and never asks for it there", async () => {
    const comparisons = scriptedComparisonClient();
    const coordinator = new CompareCoordinator(comparisons.client);
    coordinator.restore(workspaceId, identity, savedComparison("pending"));

    coordinator.useBasis(otherReading);
    coordinator.useBasis(basis);

    expect(comparisons.groups).toHaveLength(0);
    expect(coordinator.getState().comparison.phase).toBe("idle");
  });

  it("drops the answer of a saved comparison when another reading is opened before it arrives", async () => {
    const comparisons = scriptedComparisonClient();
    const coordinator = new CompareCoordinator(comparisons.client);
    coordinator.useBasis(basis);
    coordinator.restore(workspaceId, identity, savedComparison("pending"));
    const { request, reply } = comparisons.groups[0];

    coordinator.useBasis(otherReading);
    reply({ ok: true, answer: groupAnswer(request) });
    await settled();

    expect(coordinator.getState().comparison.phase).toBe("idle");
    expect(coordinator.savedComparisonFor(workspaceId, identity)).toBeNull();
  });
});
