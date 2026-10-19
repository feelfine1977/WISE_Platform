import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Bpic19Operators } from "./Bpic19Operators";
import { operatorKeepAction } from "./operator-keep";
import type { Bpic19OperatorClient, Bpic19OperatorOutcome } from "./operators-client";
import { operatorAnswer, operatorColumns, operatorIdentity, operatorRoles } from "./operators-test-fixture";
import type { Bpic19OperatorAnswer, Bpic19OperatorRequest } from "../generated/bpic19-operators";

// The service's own waiting answer for the independent literal operator fixture (peak item c).
function setup(onKeepGroup = vi.fn()) {
  const client: Bpic19OperatorClient = { operators: vi.fn(async (request: Bpic19OperatorRequest): Promise<Bpic19OperatorOutcome> => ({ ok: true, answer: operatorAnswer(request) })) };
  const props = { workspaceId: "workspace.v1:literal-fixture", identity: operatorIdentity, revision: 2, roles: operatorRoles, columns: operatorColumns, client,
    onInspect: vi.fn(), onKeepCases: vi.fn(), onKeepGroup, onReviewed: vi.fn(), onValidityChange: vi.fn() };
  render(<Bpic19Operators {...props} />);
  return { client, props, user: userEvent.setup() };
}
async function run(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByRole("button", { name: "Review and run operator" }).hasAttribute("disabled")).toBe(false));
  await user.click(screen.getByRole("button", { name: "Review and run operator" }));
  await screen.findByRole("table", { name: "Complete-item cohorts · observation groups can overlap" });
}

/** The literal's day-0 to day-6 horizon, with the reviewed authority right censoring needs. */
async function declare(user: ReturnType<typeof userEvent.setup>, completion: "completed_only" | "right_censored") {
  const end = screen.getByRole("textbox", { name: /Trusted horizon end/ });
  await user.clear(end); await user.type(end, "2018-01-07T00:00:00");
  await user.selectOptions(screen.getByRole("combobox", { name: "Incomplete recorded intervals" }), completion);
  if (completion === "right_censored") {
    const authority = screen.getByRole("textbox", { name: /Observation-horizon authority/ });
    await user.clear(authority); await user.type(authority, "Independent literal source snapshot; reviewed day6 observation cutoff");
  }
}

describe("#124 waiting occupancy purpose and the kept peak", () => {
  it("names the censored purpose and its cutoff receipt, and keeps the peak as a typed operator group", async () => {
    const { client, props, user } = setup();
    await waitFor(() => expect(vi.mocked(client.operators)).toHaveBeenCalledTimes(1));
    await user.selectOptions(screen.getByRole("combobox", { name: "Recorded-event operator" }), "waiting");
    await declare(user, "right_censored");
    await run(user);
    expect(screen.getByText(/^Right-censored occupancy over \[2018-01-01T00:00:00, 2018-01-07T00:00:00\) on the source's wall-clock clock/)).toBeTruthy();
    expect(screen.getByText(/Cutoff receipt: horizon end 2018-01-07T00:00:00 · provenance Independent literal source snapshot; reviewed day6 observation cutoff · preparation trusted cutoff 2018-01-21T00:00:00/)).toBeTruthy();
    expect(screen.getByText(/Neither reading is an overdue or breach judgement: no obligation or due date is supplied\./)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep earliest peak occupancy items" }));
    expect(props.onKeepGroup).toHaveBeenCalledTimes(1);
    expect(props.onKeepCases).not.toHaveBeenCalled();
    const [answer, key] = props.onKeepGroup.mock.calls[0] as [Bpic19OperatorAnswer, string];
    expect(key).toBe("peak");
    const action = operatorKeepAction(answer, key, { kind: "case_id_in", case_ids: ["c"], negate: false }, 0, 0);
    expect(action).toEqual(expect.objectContaining({ operation: "bpic19_waiting", definition_id: answer.definition_id, query: answer.query, selection_prefix_length: 0,
      selection_keep: { policy_id: "bpic19.operator_group_keep.v1", step_index: 0, group: { kind: "operator_group", key: "peak" } } }));
    // Another membership is not bound to the peak.
    expect(operatorKeepAction(answer, key, { kind: "case_id_in", case_ids: ["a"], negate: false }, 0, 0)).toBeNull();
  });

  it("names the retrospective purpose for completed-only occupancy", async () => {
    const { client, user } = setup();
    await waitFor(() => expect(vi.mocked(client.operators)).toHaveBeenCalledTimes(1));
    await user.selectOptions(screen.getByRole("combobox", { name: "Recorded-event operator" }), "waiting");
    await declare(user, "completed_only");
    await run(user);
    expect(screen.getByText(/^Retrospective completed-item occupancy over \[2018-01-01T00:00:00, 2018-01-07T00:00:00\)/)).toBeTruthy();
    expect(screen.getByText(/an item without a recorded response is excluded, never treated as complete/)).toBeTruthy();
  });
});
