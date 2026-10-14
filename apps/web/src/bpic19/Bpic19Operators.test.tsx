import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Bpic19Operators } from "./Bpic19Operators";
import type { Bpic19OperatorRequest, OperatorQuery } from "../generated/bpic19-operators";
import type { Bpic19OperatorClient, Bpic19OperatorOutcome } from "./operators-client";
import { operatorAnswer, operatorColumns, operatorIdentity, operatorRecipe, operatorRoles } from "./operators-test-fixture";
const answering = (request: Bpic19OperatorRequest): Bpic19OperatorOutcome => ({ ok: true, answer: operatorAnswer(request) });
function setup(client: Bpic19OperatorClient = { operators: vi.fn(async request => answering(request)) }, query?: OperatorQuery) {
  const props = { workspaceId: "workspace.v1:literal-fixture", identity: operatorIdentity, revision: 2, roles: operatorRoles, columns: operatorColumns, query, client, onInspect: vi.fn(), onKeepCases: vi.fn(), onReviewed: vi.fn(), onValidityChange: vi.fn() };
  return { ...render(<Bpic19Operators {...props} />), props, client, user: userEvent.setup() };
}
async function run(user: ReturnType<typeof userEvent.setup>) { await waitFor(() => expect(screen.getByRole("button", { name: "Review and run operator" }).hasAttribute("disabled")).toBe(false));await user.click(screen.getByRole("button", { name: "Review and run operator" }));await screen.findByRole("table", { name: "Complete-item cohorts · observation groups can overlap" }); }

describe("visible finite recorded-event operators", () => {
  it("loads a catalogue without author confirmation, then runs ordinal and retains exact whole-item evidence", async () => {
    const { user, props, client } = setup();
    await waitFor(() => expect(vi.mocked(client.operators)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(client.operators).mock.calls[0][0].query.recipe).toBeNull();expect(props.onReviewed).not.toHaveBeenCalled();
    await run(user);expect(props.onReviewed).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText("Item a · evaluated · 4 original records"));
    const evidence = await screen.findByRole("table", { name: "Item a inferred observations and original witnesses" });
    expect(within(evidence).getByText(/Stage records:/).textContent).toContain(" → ");
    await user.click(screen.getByRole("button", { name: "Inspect complete item a" }));
    expect(props.onInspect).toHaveBeenLastCalledWith("a", operatorAnswer(vi.mocked(client.operators).mock.calls[1][0]).cases[0].record_row_ids);
    await user.click(screen.getByRole("button", { name: "Inspect observation 1 of a" }));
    expect(props.onInspect.mock.calls.at(-1)?.[1]).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Keep observation matched items" }));
    expect(props.onKeepCases).toHaveBeenLastCalledWith(["a"], "bpic19_ordinal: observation matched");
  });
  it("exposes and submits every declared operator choice through the client", async () => {
    const { user, client, props } = setup();await run(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "Recorded-event operator" }), "fifo");
    await user.selectOptions(screen.getByRole("combobox", { name: "FIFO ordering" }), "timestamp_source_position");
    await user.selectOptions(screen.getByRole("combobox", { name: "FIFO parsed-time eligibility" }), "strict_time");
    await run(user);expect(vi.mocked(client.operators).mock.calls.at(-1)?.[0].query.recipe).toMatchObject({ kind: "fifo", order: "timestamp_source_position", ties: "strict_time" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Recorded-event operator" }), "cancellation");
    await user.selectOptions(screen.getByRole("combobox", { name: "Separate amount-dependent filter" }), "opposite");
    await user.selectOptions(screen.getByRole("combobox", { name: "Cancellation target reuse" }), "allow");
    await user.selectOptions(screen.getByRole("combobox", { name: "Equally latest target policy" }), "source_position");
    await user.selectOptions(screen.getByRole("combobox", { name: "Temporal predecessor eligibility" }), "allow_equal_source_before");
    await run(user);expect(vi.mocked(client.operators).mock.calls.at(-1)?.[0].query.recipe).toMatchObject({ kind: "cancellation", amount_filter: "opposite", reuse: "allow", ambiguity: "source_position", ties: "allow_equal_source_before" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Recorded-event operator" }), "rule");
    await user.selectOptions(screen.getByRole("combobox", { name: "Recorded-event relation A → B" }), "precedence");
    await user.selectOptions(screen.getByRole("combobox", { name: "Relation position policy" }), "raw_direct");
    await user.selectOptions(screen.getByRole("combobox", { name: "Quantifier over activations" }), "some");
    await user.selectOptions(screen.getByRole("combobox", { name: "Equal parsed-time policy" }), "strict");
    await run(user);expect(vi.mocked(client.operators).mock.calls.at(-1)?.[0].query.recipe).toMatchObject({ kind: "rule", relation: "precedence", position: "raw_direct", quantifier: "some", ties: "strict" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Recorded-event operator" }), "waiting");
    await user.selectOptions(screen.getByRole("combobox", { name: "Waiting endpoint definition" }), "first_after");
    await user.selectOptions(screen.getByRole("combobox", { name: "Incomplete recorded intervals" }), "right_censored");
    expect(screen.getByRole("button", { name: "Review and run operator" }).hasAttribute("disabled")).toBe(true);
    await user.type(screen.getByRole("textbox", { name: /Observation-horizon authority/ }), "Reviewed literal observation metadata");
    await user.selectOptions(screen.getByRole("combobox", { name: "Intervals outside the explicit horizon" }), "clip");
    await user.selectOptions(screen.getByRole("combobox", { name: "Occupancy calendar" }), "daily_snapshots");
    await run(user);expect(vi.mocked(client.operators).mock.calls.at(-1)?.[0].query.recipe).toMatchObject({ kind: "waiting", endpoints: "first_after", completion: "right_censored", horizon_provenance: "Reviewed literal observation metadata", horizon_policy: "clip", calendar: "daily_snapshots" });
    expect(await screen.findByRole("heading", { name: "Half-open waiting inventory" })).toBeTruthy();
    expect(props.onReviewed).toHaveBeenCalledTimes(5);
  });
  it("pauses stale witnesses and saves for draft changes, then restores the reviewed definition", async () => {
    const { user, props, client } = setup();await run(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "Ordinal ordering" }), "timestamp_source_position");
    expect(props.onValidityChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: "Keep observation matched items" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Download reviewed operator receipt" }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Restore reviewed operator" }));
    expect(vi.mocked(client.operators)).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Keep observation matched items" }).hasAttribute("disabled")).toBe(false);
    await waitFor(() => expect(props.onValidityChange).toHaveBeenLastCalledWith(true));
  });
  it("accepts a reviewed-query feedback without duplicate replay, then auto-replays a fresh saved revision", async () => {
    const { user, props, client, rerender } = setup();await run(user);
    const reviewed = props.onReviewed.mock.calls[0][0];
    rerender(<Bpic19Operators {...props} query={reviewed.query} />);
    await waitFor(() => expect(props.onValidityChange).toHaveBeenLastCalledWith(true));
    expect(vi.mocked(client.operators)).toHaveBeenCalledTimes(2);
    rerender(<Bpic19Operators {...props} query={reviewed.query} revision={3} />);
    await waitFor(() => expect(props.onReviewed).toHaveBeenCalledTimes(2));
    expect(vi.mocked(client.operators).mock.calls.at(-1)?.[0].query).toEqual(reviewed.query);
    expect(vi.mocked(client.operators).mock.calls.at(-1)?.[0].query_revision).toBe(3);
  });
  it.each(["success", "failure"])("fences delayed %s after a draft changes, while preserving the old reviewed receipt", async outcome => {
    let release: ((outcome: Bpic19OperatorOutcome) => void) | undefined;
    let count = 0;
    const client: Bpic19OperatorClient = { operators: vi.fn((request): Promise<Bpic19OperatorOutcome> => ++count === 3 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(answering(request))) };
    const { user, props } = setup(client);await run(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "Ordinal ordering" }), "timestamp_source_position");
    await user.click(screen.getByRole("button", { name: "Review and run operator" }));
    const pending = vi.mocked(client.operators).mock.calls[2];
    await user.selectOptions(screen.getByRole("combobox", { name: "Receipt selector" }), "goods_or_service");
    expect(pending[1].aborted).toBe(true);
    await act(async () => release?.(outcome === "success" ? answering(pending[0]) : { ok: false, problem: { kind: "unreachable" } }));
    expect(props.onReviewed).toHaveBeenCalledTimes(1);expect(screen.queryByRole("alert")).toBeNull();expect(props.onValidityChange).toHaveBeenLastCalledWith(false);
  });
  it("requires valid exact labels, restores saved recipes and retries the same refused recipe", async () => {
    let count = 0;
    const client: Bpic19OperatorClient = { operators: vi.fn(async (request): Promise<Bpic19OperatorOutcome> => ++count === 2 ? { ok: false, problem: { kind: "unreachable" } } : answering(request)) };
    const query: OperatorQuery = { policy_id: "bpic19.declared_operators.v1", roles: operatorRoles, recipe: operatorRecipe("rule"), offset: 0, limit: 20 };
    const { user, props } = setup(client, query);
    await waitFor(() => expect(props.onReviewed).toHaveBeenCalledTimes(1));
    expect(vi.mocked(client.operators).mock.calls[0][0].query).toEqual(query);
    await waitFor(() => expect(screen.getByRole("button", { name: "Review and run operator" }).hasAttribute("disabled")).toBe(false));
    await user.click(screen.getByRole("button", { name: "Review and run operator" }));
    expect((await screen.findByRole("alert")).textContent).toContain("service could not be reached");
    await user.click(screen.getByRole("button", { name: "Retry operator" }));await screen.findByRole("table", { name: "Complete-item cohorts · observation groups can overlap" });
    expect(vi.mocked(client.operators).mock.calls[1][0].query).toEqual(vi.mocked(client.operators).mock.calls[2][0].query);
    const input = screen.getByRole("textbox", { name: /Left activity labels/ });await user.clear(input);await user.type(input,"A{enter}A");
    expect(screen.getByRole("button", { name: "Review and run operator" }).hasAttribute("disabled")).toBe(true);
    expect(props.onValidityChange).toHaveBeenLastCalledWith(false);
  });
});
