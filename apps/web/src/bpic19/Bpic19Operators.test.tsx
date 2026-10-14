import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Bpic19Operators, type Bpic19OperatorComparison } from "./Bpic19Operators";
import type { Bpic19OperatorRequest, OperatorQuery } from "../generated/bpic19-operators";
import type { Bpic19OperatorClient, Bpic19OperatorOutcome } from "./operators-client";
import { operatorAnswer, operatorColumns, operatorIdentity, operatorRecipe, operatorRoles } from "./operators-test-fixture";
const answering = (request: Bpic19OperatorRequest): Bpic19OperatorOutcome => ({ ok: true, answer: operatorAnswer(request) });
function setup(client: Bpic19OperatorClient = { operators: vi.fn(async request => answering(request)) }, query?: OperatorQuery, retainedQueries?: OperatorQuery[], restoredComparison?: Bpic19OperatorComparison) {
  const props = { workspaceId: "workspace.v1:literal-fixture", identity: operatorIdentity, revision: 2, roles: operatorRoles, columns: operatorColumns, query, retainedQueries, restoredComparison, client, onInspect: vi.fn(), onKeepCases: vi.fn(), onReviewed: vi.fn(), onRetain: vi.fn(), onCompared: vi.fn(), onComparisonValidityChange: vi.fn(), onValidityChange: vi.fn() };
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
  it("offers timestamp/numeric-eventID FIFO separately and requires the reviewed original field", async () => {
    const { user, props, client } = setup();await run(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "Recorded-event operator" }), "fifo");
    const ordering = screen.getByRole("combobox", { name: "FIFO ordering" });
    expect(ordering).toHaveProperty("value", "source_position");
    expect(within(ordering).getByRole("option", { name: /R08 reproduction/ })).toHaveProperty("value", "source_position");
    await user.selectOptions(ordering, "timestamp_numeric_event_id");
    expect(screen.getByText(/This declared tie convention does not prove chronology/)).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox", { name: "Original eventID field" }), "");
    expect(screen.getByRole("alert").textContent).toContain("Review and map the original eventID field");
    expect(screen.getByRole("button", { name: "Review and run operator" }).hasAttribute("disabled")).toBe(true);
    expect(props.onValidityChange).toHaveBeenLastCalledWith(false);
    await user.selectOptions(screen.getByRole("combobox", { name: "Original eventID field" }), String(operatorRoles.event_id));
    await run(user);
    expect(vi.mocked(client.operators).mock.calls.at(-1)?.[0].query.recipe).toMatchObject({ kind: "fifo", order: "timestamp_numeric_event_id", ties: "allow_equal" });
    expect(vi.mocked(client.operators).mock.calls.at(-1)?.[0].query.roles.event_id).toBe(operatorRoles.event_id);
  });
  it("automatically replays the exact saved timestamp/numeric-eventID FIFO recipe", async () => {
    const old = operatorRecipe("fifo");if (old.kind !== "fifo") throw new Error("Literal FIFO recipe missing");
    const query: OperatorQuery = { policy_id: "bpic19.declared_operators.v1", roles: operatorRoles, recipe: { ...old, order: "timestamp_numeric_event_id", stages: "auto_flow", ties: "strict_time" }, offset: 0, limit: 20 };
    const { props, client } = setup(undefined, query);
    await waitFor(() => expect(props.onReviewed).toHaveBeenCalledTimes(1));
    expect(vi.mocked(client.operators).mock.calls[0][0].query).toEqual(query);
    expect(screen.getByRole("combobox", { name: "FIFO ordering" })).toHaveProperty("value", "timestamp_numeric_event_id");
    expect(screen.getByRole("combobox", { name: "Episode stage sequence" })).toHaveProperty("value", "auto_flow");
    expect(screen.getByRole("combobox", { name: "FIFO parsed-time eligibility" })).toHaveProperty("value", "strict_time");
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

function retainedQuery(kind: "ordinal" | "fifo"): OperatorQuery { return { policy_id: "bpic19.declared_operators.v1", roles: operatorRoles, recipe: operatorRecipe(kind), offset: 0, limit: 20 }; }

describe("explicit retained operator restoration and comparison", () => {
  it("selects an exact saved nondefault recipe and retains only on explicit request", async () => {
    const original = retainedQuery("ordinal");
    if (original.recipe?.kind !== "ordinal") throw new Error("Literal ordinal recipe missing");
    const saved: OperatorQuery = { ...original, recipe: { ...original.recipe, order: "timestamp_source_position", stages: "ir_ci", cancellation: "exclude_item" } };
    const { user, client, props } = setup(undefined, undefined, [saved]);
    await waitFor(() => expect(vi.mocked(client.operators)).toHaveBeenCalledTimes(1));
    const selector = screen.getByRole("combobox", { name: "Retained reviewed operator definition" });
    await user.selectOptions(selector, within(selector).getAllByRole("option")[1].getAttribute("value")!);
    await waitFor(() => expect(props.onReviewed).toHaveBeenCalledTimes(1));
    expect(vi.mocked(client.operators).mock.calls[1][0].query).toEqual(saved);
    expect(screen.getByRole("combobox", { name: "Ordinal ordering" })).toHaveProperty("value", "timestamp_source_position");
    expect(screen.getByRole("combobox", { name: "Episode stage sequence" })).toHaveProperty("value", "ir_ci");
    expect(props.onRetain).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Retain reviewed result for comparison and saving" }));
    expect(props.onRetain).toHaveBeenCalledTimes(1);expect(props.onRetain.mock.calls[0][0].query).toEqual(saved);
    await user.selectOptions(screen.getByRole("combobox", { name: "Recorded-event operator" }), "fifo");
    expect(props.onRetain).toHaveBeenCalledTimes(1);
  });
  it("reads both verified retained recipes, shows supplied whole-population counts and opens original evidence", async () => {
    const { user, props, client } = setup(undefined, undefined, [retainedQuery("ordinal"), retainedQuery("fifo")]);
    await waitFor(() => expect(vi.mocked(client.operators)).toHaveBeenCalledTimes(1));
    await user.click(screen.getByText("Compare explicitly retained ordinal and FIFO definitions"));
    for (const label of ["Retained ordinal definition", "Retained FIFO definition"]) {
      const control = screen.getByRole("combobox", { name: label });await user.selectOptions(control, within(control).getAllByRole("option")[1].getAttribute("value")!);
    }
    await user.click(screen.getByRole("button", { name: "Read retained ordinal/FIFO comparison" }));
    const left = await screen.findByRole("table", { name: "bpic19_ordinal whole-population known matching counts" });
    const right = screen.getByRole("table", { name: "bpic19_fifo whole-population known matching counts" });
    expect(within(left).getByRole("row", { name: /paired episode count/ }).textContent).toContain("inferred episodes1");
    expect(within(right).getByRole("row", { name: /paired endpoint event count/ }).textContent).toContain("original events3");
    expect(vi.mocked(client.operators).mock.calls.slice(1).map(([request]) => request.query.recipe?.kind)).toEqual(["ordinal","fifo"]);
    expect(props.onReviewed).not.toHaveBeenCalled();expect(props.onRetain).not.toHaveBeenCalled();
    expect(props.onCompared).toHaveBeenCalledExactlyOnceWith({ policy_id: "bpic19.ordinal_fifo_comparison.v1", identity: operatorIdentity,
      ordinal: { definition_id: operatorAnswer(vi.mocked(client.operators).mock.calls[1][0]).definition_id, query: retainedQuery("ordinal") },
      fifo: { definition_id: operatorAnswer(vi.mocked(client.operators).mock.calls[2][0]).definition_id, query: retainedQuery("fifo") } });
    const article = screen.getByRole("heading", { name: "Retained ordinal result" }).closest("article");if (!article) throw new Error("Ordinal comparison article missing");
    await user.click(within(article).getByText("Item a · evaluated · 4 original records"));await user.click(within(article).getByRole("button", { name: "Inspect complete item a" }));
    expect(props.onInspect).toHaveBeenLastCalledWith("a", operatorAnswer(vi.mocked(client.operators).mock.calls[1][0]).cases[0].record_row_ids);
  });
  it("publishes no partial pair and fences a cancelled/delayed comparison", async () => {
    let release: ((outcome: Bpic19OperatorOutcome) => void) | undefined;
    const client: Bpic19OperatorClient = { operators: vi.fn((request): Promise<Bpic19OperatorOutcome> => request.request_id.startsWith("bpic19-compare") && request.query.recipe?.kind === "fifo" ? new Promise(resolve => { release = resolve; }) : Promise.resolve(answering(request))) };
    const { user, props } = setup(client, undefined, [retainedQuery("ordinal"), retainedQuery("fifo")]);
    await waitFor(() => expect(vi.mocked(client.operators)).toHaveBeenCalledTimes(1));await user.click(screen.getByText("Compare explicitly retained ordinal and FIFO definitions"));
    for (const label of ["Retained ordinal definition", "Retained FIFO definition"]) {
      const control = screen.getByRole("combobox", { name: label });await user.selectOptions(control, within(control).getAllByRole("option")[1].getAttribute("value")!);
    }
    await user.click(screen.getByRole("button", { name: "Read retained ordinal/FIFO comparison" }));expect(screen.queryByRole("heading", { name: "Retained ordinal result" })).toBeNull();
    const pending = vi.mocked(client.operators).mock.calls[2];await user.click(screen.getByRole("button", { name: "Cancel comparison request" }));expect(pending[1].aborted).toBe(true);
    await act(async () => release?.(answering(pending[0])));expect(screen.queryByRole("heading", { name: "Retained FIFO result" })).toBeNull();
    expect(props.onReviewed).not.toHaveBeenCalled();expect(props.onRetain).not.toHaveBeenCalled();
    expect(props.onCompared).not.toHaveBeenCalled();expect(props.onComparisonValidityChange).toHaveBeenLastCalledWith(false);
  });
});

function explicitPair(ordinal = retainedQuery("ordinal"), fifo = retainedQuery("fifo")): Bpic19OperatorComparison {
  const request = (query: OperatorQuery): Bpic19OperatorRequest => ({ schema_version: 1, message_type: "bpic19_operator_request", request_id: "literal-pair", query_revision: 2, workspace_id: "workspace.v1:literal-fixture", identity: operatorIdentity, query });
  return { policy_id: "bpic19.ordinal_fifo_comparison.v1", identity: operatorIdentity,
    ordinal: { definition_id: operatorAnswer(request(ordinal)).definition_id, query: ordinal },
    fifo: { definition_id: operatorAnswer(request(fifo)).definition_id, query: fifo } };
}

describe("explicit comparison-pair persistence boundary", () => {
  it("automatically restores the declared nondefault pair among four alternatives without inferring a pair", async () => {
    const firstOrdinal = retainedQuery("ordinal"), firstFifo = retainedQuery("fifo");
    if (firstOrdinal.recipe?.kind !== "ordinal" || firstFifo.recipe?.kind !== "fifo") throw new Error("Literal pair missing");
    const secondOrdinal: OperatorQuery = { ...firstOrdinal, recipe: { ...firstOrdinal.recipe, order: "timestamp_source_position", stages: "ir_ci" } };
    const secondFifo: OperatorQuery = { ...firstFifo, recipe: { ...firstFifo.recipe, stages: "ir_ci", ties: "strict_time" } };
    const pair = explicitPair(secondOrdinal, secondFifo);
    const { client, props, rerender } = setup(undefined, undefined, [firstOrdinal, secondOrdinal, firstFifo, secondFifo], pair);
    await screen.findByRole("heading", { name: "Retained ordinal result" });
    expect(vi.mocked(client.operators).mock.calls.filter(([request]) => request.request_id.startsWith("bpic19-compare")).map(([request]) => request.query)).toEqual([secondOrdinal, secondFifo]);
    expect(props.onCompared).toHaveBeenCalledExactlyOnceWith(pair);expect(props.onComparisonValidityChange).toHaveBeenLastCalledWith(true);
    rerender(<Bpic19Operators {...props} restoredComparison={structuredClone(pair)} />);
    expect(vi.mocked(client.operators)).toHaveBeenCalledTimes(3);
    rerender(<Bpic19Operators {...props} restoredComparison={structuredClone(pair)} revision={3} />);
    await waitFor(() => expect(props.onCompared).toHaveBeenCalledTimes(2));
    expect(vi.mocked(client.operators).mock.calls.filter(([request]) => request.request_id.startsWith("bpic19-compare")).at(-1)?.[0].query_revision).toBe(3);
  });
  it("never auto-compares retained alternatives without an explicit saved pair", async () => {
    const { client, props } = setup(undefined, undefined, [retainedQuery("ordinal"), retainedQuery("fifo")]);
    await waitFor(() => expect(vi.mocked(client.operators)).toHaveBeenCalledTimes(1));
    expect(props.onCompared).not.toHaveBeenCalled();expect(props.onComparisonValidityChange).not.toHaveBeenCalled();
  });
  it.each(["foreign_population", "wrong_recipe_kind", "mismatched_definition"])("refuses a restored %s without substituting current defaults", async kind => {
    const pair = explicitPair();
    if (kind === "foreign_population") pair.identity = { ...operatorIdentity, population_id: "population.v1:sha256:" + "f".repeat(64) };
    if (kind === "wrong_recipe_kind") pair.ordinal.query = retainedQuery("fifo");
    if (kind === "mismatched_definition") pair.ordinal.definition_id = "changed-definition";
    const { props } = setup(undefined, undefined, [], pair);
    await screen.findByRole("alert");
    expect(props.onCompared).not.toHaveBeenCalled();expect(props.onComparisonValidityChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("heading", { name: "Retained ordinal result" })).toBeNull();
  });
  it("marks an edited pair unsavable, then explicitly replays the prior reviewed pair", async () => {
    const pair = explicitPair();const { props, user } = setup(undefined, undefined, [], pair);
    await screen.findByRole("heading", { name: "Retained FIFO result" });
    const control = screen.getByRole("combobox", { name: "Retained FIFO definition" });
    await user.selectOptions(control, "");expect(props.onComparisonValidityChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("heading", { name: "Retained FIFO result" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Restore reviewed ordinal/FIFO comparison" }));
    await screen.findByRole("heading", { name: "Retained FIFO result" });
    expect(props.onCompared).toHaveBeenCalledTimes(2);expect(props.onCompared).toHaveBeenLastCalledWith(pair);
    expect(props.onComparisonValidityChange).toHaveBeenLastCalledWith(true);
  });
  it("fences a restored pair's delayed response when another explicit pair is supplied", async () => {
    let release: ((outcome: Bpic19OperatorOutcome) => void) | undefined;
    const first = explicitPair(), next = explicitPair();
    if (next.fifo.query.recipe?.kind !== "fifo") throw new Error("Literal FIFO missing");
    next.fifo.query = { ...next.fifo.query, recipe: { ...next.fifo.query.recipe, ties: "strict_time" } };
    const client: Bpic19OperatorClient = { operators: vi.fn((request): Promise<Bpic19OperatorOutcome> => request.request_id.startsWith("bpic19-compare") && request.query.recipe?.kind === "fifo" && request.query.recipe.ties === "allow_equal" ? new Promise(resolve => { release = resolve; }) : Promise.resolve(answering(request))) };
    const { props, rerender } = setup(client, undefined, [], first);
    await waitFor(() => expect(vi.mocked(client.operators)).toHaveBeenCalledTimes(3));
    const pending = vi.mocked(client.operators).mock.calls[2];rerender(<Bpic19Operators {...props} restoredComparison={next} />);
    await screen.findByRole("heading", { name: "Retained FIFO result" });expect(pending[1].aborted).toBe(true);
    await act(async () => release?.(answering(pending[0])));
    expect(props.onCompared).toHaveBeenCalledExactlyOnceWith(next);
  });
});
