import { describe, expect, it } from "vitest";
import type { SavedComparison } from "../generated/saving";
import { identity, workspaceId } from "../test/imports";
import { groupAnswer, scriptedComparisonClient } from "../test/comparisons";
import { comparisonContract } from "./client";
import { type CompareBasis, CompareCoordinator } from "./coordinator";

const basis: CompareBasis = { workspaceId, identity, clock: "utc_instant", contextColumns: [3] };
const savedGroup: SavedComparison = {
  kind: "group", comparison_id: `comparison.v1:sha256:${"e".repeat(64)}`,
  parent_case_ids: ["C-1", "C-2", "C-3", "C-4"], context_column_index: 3,
  context_policy: "incident.context.first_record_in_declared_order.v1",
  definition: { mode: "two_named_groups",
    target: { name: "Assigned", definition: { kind: "predicates", predicates: [{ kind: "contains_activity", activity: "Assigned", negate: false }] } },
    reference: { name: "Listed", definition: { kind: "explicit_case_ids", case_ids: ["C-1", "C-2", "C-3"] } },
  },
};
async function settle() { await Promise.resolve(); await Promise.resolve(); }

describe("independent saved-comparison restoration boundaries", () => {
  it("clears a previously answered comparison when reopened content has no comparison on the same reading", async () => {
    const client = scriptedComparisonClient();
    const coordinator = new CompareCoordinator(client.client);
    coordinator.useBasis(basis);
    coordinator.restore(workspaceId, identity, savedGroup);
    const call = client.groups[0];
    const answer = groupAnswer(call.request);
    expect(comparisonContract.groupAnswer(answer)).toBe(true);
    call.reply({ ok: true, answer });
    await settle();
    expect(coordinator.getState().comparison.phase).toBe("ready");
    coordinator.restore(workspaceId, identity, null);
    expect(coordinator.getState().comparison.phase).toBe("idle");
    expect(coordinator.savedComparisonFor(workspaceId, identity)).toBeNull();
  });

  it("drops a pending prior comparison success when a same-reading investigation reopens without a comparison", async () => {
    const client = scriptedComparisonClient();
    const coordinator = new CompareCoordinator(client.client);
    coordinator.useBasis(basis);
    coordinator.restore(workspaceId, identity, savedGroup);
    const call = client.groups[0];
    coordinator.restore(workspaceId, identity, null);
    call.reply({ ok: true, answer: groupAnswer(call.request) });
    await settle();
    expect(coordinator.getState().comparison.phase).toBe("idle");
    expect(coordinator.savedComparisonFor(workspaceId, identity)).toBeNull();
  });

  it.each(["utc_instant", "wall_clock"] as const)("replays and retries exact hourly half-open bounds on %s", async (clock) => {
    const client = scriptedComparisonClient();
    const coordinator = new CompareCoordinator(client.client);
    coordinator.useBasis({ ...basis, clock });
    const zone = clock === "utc_instant" ? "Z" : "";
    const definition = { target: { name: "Nine o'clock starts", window: { timestamp_kind: clock,
      start_inclusive: `2026-10-09T09:00:00${zone}`, end_exclusive: `2026-10-09T10:00:00${zone}` } },
      reference: { name: "Eleven o'clock starts", window: { timestamp_kind: clock,
        start_inclusive: `2026-10-09T11:00:00${zone}`, end_exclusive: `2026-10-09T12:00:00${zone}` } },
      minimum_followup_hours: 1.5, endpoint_activity: "Resolved" };
    const saved = { kind: "period", comparison_id: `comparison.v1:sha256:${"d".repeat(64)}`,
      parent_case_ids: ["C-1", "C-2", "C-3"], context_column_index: 3,
      context_policy: "incident.context.first_record_in_declared_order.v1", definition };
    // The request branch is chosen at runtime; source validation checks clock coupling.
    coordinator.restore(workspaceId, identity, saved as SavedComparison);
    const first = client.periods[0];
    expect(comparisonContract.periodRequest(first.request)).toBe(true);
    expect(first.request.definition).toEqual(saved.definition);
    expect(first.request.parent_case_ids).toEqual(saved.parent_case_ids);
    expect(first.request.context_column_index).toBe(saved.context_column_index);
    expect(first.request.context_policy).toBe(saved.context_policy);
    first.reply({ ok: false, problem: { kind: "unreachable" } });
    await settle();
    coordinator.retry();
    const retry = client.periods[1];
    expect(retry.request.definition).toEqual(saved.definition);
    expect(retry.request.parent_case_ids).toEqual(saved.parent_case_ids);
    expect(retry.request.query_revision).toBeGreaterThan(first.request.query_revision);
  });
});
