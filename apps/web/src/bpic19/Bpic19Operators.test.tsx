import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Bpic19Operators, type Bpic19OperatorComparison } from "./Bpic19Operators";
import type { Bpic19OperatorAnswer, Bpic19OperatorRequest, OperatorQuery } from "../generated/bpic19-operators";
import type { Bpic19OperatorClient, Bpic19OperatorOutcome } from "./operators-client";
import { operatorAnswer, operatorColumns, operatorIdentity, operatorRecipe, operatorRoles } from "./operators-test-fixture";
import { bpic19OperatorContract } from "./operators-client";
import { Bpic19Workspace } from "./Bpic19Workspace";
import { Bpic19Session } from "./session";
import { CompareCoordinator } from "../compare/coordinator";
import { ImportedInvestigationCoordinator, shownSelection, type SavedBinding } from "../imported/coordinator";
import { SavingCoordinator } from "../saved/coordinator";
import { scriptedComparisonClient } from "../test/comparisons";
import { populationAnswer, preparationId, earlierPreparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { everyIncident, graphAnswer, scriptedSelectionClient, selectionAnswer } from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { firstRevisionId, secondRevisionId, savedContent, savedSummary, reopenAnswer, saveAnswer, scriptedSavingClient } from "../test/saving";
import { bpic19ProfileContract } from "./profile-client";
import { bpic19MeasuresContract } from "./measures-client";
import { measuresAnswer } from "./measures-test-fixture";
const answering = (request: Bpic19OperatorRequest): Bpic19OperatorOutcome => ({ ok: true, answer: operatorAnswer(request) });
function setup(client: Bpic19OperatorClient = { operators: vi.fn(async request => answering(request)) }, query?: OperatorQuery, retainedQueries?: OperatorQuery[], restoredComparison?: Bpic19OperatorComparison) {
  const props = { workspaceId: "workspace.v1:literal-fixture", identity: operatorIdentity, revision: 2, roles: operatorRoles, columns: operatorColumns, query, retainedQueries, restoredComparison, client, onInspect: vi.fn(), onKeepCases: vi.fn(), onReviewed: vi.fn(), onRetain: vi.fn(), onCompared: vi.fn(), onComparisonValidityChange: vi.fn(), onValidityChange: vi.fn() };
  return { ...render(<Bpic19Operators {...props} />), props, client, user: userEvent.setup() };
}
async function run(user: ReturnType<typeof userEvent.setup>) { await waitFor(() => expect(screen.getByRole("button", { name: "Review and run operator" }).hasAttribute("disabled")).toBe(false));await user.click(screen.getByRole("button", { name: "Review and run operator" }));await screen.findByRole("table", { name: "Complete-item cohorts · observation groups can overlap" }); }

describe("optional recorded-rule Method admission (synthetic HTTP boundary, no native proof)", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("sends a closed normative request with the unchanged HTTP client and retains current descriptive evidence after refusal", async () => {
    const requests: Bpic19OperatorRequest[] = [];
    // Synthetic browser download sink: execute the real receipt formatter and
    // click callback without claiming a rendered-browser download journey.
    const blobs: Blob[] = [], filenames: string[] = [];
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL(value: Blob | MediaSource) { if (!(value instanceof Blob)) throw new Error("Expected receipt Blob"); blobs.push(value); return `blob:rule-receipt-${blobs.length}`; }
      static revokeObjectURL() {}
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filenames.push(this.download); });
    const blobText = (value: Blob) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(value);
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as Bpic19OperatorRequest;
      expect(bpic19OperatorContract.request(request)).toBe(true);
      requests.push(request);
      const body = request.intent === "normative_admission" ? {
        schema_version: 1, message_type: "bpic19_operator_refusal", request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id,
        operation: "bpic19_operators", code: "method_binding_unavailable", message: "This recorded-event rule has no admitted actual Method binding for normative grading.", field: "intent", retryable: false,
        method_context: { intent: "normative_admission", identity: request.identity, query: request.query, definition_id: operatorAnswer(request).definition_id },
      } : operatorAnswer(request);
      return new Response(JSON.stringify(body), { status: request.intent ? 409 : 200 });
    });
    const props = { workspaceId: "workspace.v1:literal-fixture", identity: operatorIdentity, revision: 2, roles: operatorRoles, columns: operatorColumns, onInspect: vi.fn(), onKeepCases: vi.fn(), onReviewed: vi.fn(), onRetain: vi.fn(), onValidityChange: vi.fn() };
    render(<Bpic19Operators {...props} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "Recorded-event operator" }), "rule");
    const action = screen.getByRole("button", { name: "Check normative Method availability" });
    expect(action.hasAttribute("disabled")).toBe(true);
    await run(user);
    await waitFor(() => expect(props.onValidityChange).toHaveBeenLastCalledWith(true));
    const reviewed = props.onReviewed.mock.calls[0][0];
    await user.click(screen.getByRole("button", { name: "Download reviewed operator receipt" }));
    const exportedBefore = await blobText(blobs[0]);
    const validityCount = props.onValidityChange.mock.calls.length;
    action.focus();
    await user.keyboard("{Enter}");
    expect((await screen.findByRole("status", { name: "Normative Method availability" })).textContent).toContain("no admitted actual Method binding");
    expect(screen.getByRole("status", { name: "Normative Method availability" }).textContent).toContain("Descriptive result and complete original histories remain usable");
    expect(requests.at(-1)).toMatchObject({ intent: "normative_admission", identity: reviewed.identity, query: reviewed.query });
    expect(props.onReviewed).toHaveBeenCalledTimes(1);
    expect(props.onValidityChange.mock.calls).toHaveLength(validityCount);
    expect(screen.getByRole("button", { name: "Download reviewed operator receipt" }).hasAttribute("disabled")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Download reviewed operator receipt" }));
    expect(await blobText(blobs[1])).toBe(exportedBefore);
    expect(JSON.parse(exportedBefore)).toEqual(reviewed);
    expect(filenames).toHaveLength(2);
    expect(filenames[1]).toBe(filenames[0]);
    await user.click(screen.getByRole("button", { name: "Keep truth false items" }));
    expect(props.onKeepCases).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Inspect truth false member" }));
    expect(props.onInspect).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Retain reviewed result for comparison and saving" }));
    expect(props.onRetain).toHaveBeenLastCalledWith(reviewed);
    expect(props.onRetain.mock.calls[0][0].query).not.toHaveProperty("intent");
  });
  it.each(["draft", "source", "workspace", "population", "cancel"].flatMap(change => ["success", "error", "refusal"].map(delivery => ({ change, delivery }))))("fences a delivered old $delivery after $change while keeping the current descriptive answer usable", async ({ change, delivery }) => {
    let resolve: ((value: Bpic19OperatorOutcome) => void) | undefined;
    let reject: ((reason: Error) => void) | undefined;
    const client: Bpic19OperatorClient = { operators: vi.fn(request => request.intent === "normative_admission" ? new Promise<Bpic19OperatorOutcome>((done, fail) => { resolve = done; reject = fail; }) : Promise.resolve(answering(request))) };
    const query: OperatorQuery = { policy_id: "bpic19.declared_operators.v1", roles: operatorRoles, recipe: operatorRecipe("rule"), offset: 0, limit: 20 };
    const { user, props, rerender } = setup(client, query);
    await waitFor(() => expect(props.onReviewed).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Check normative Method availability" }));
    const pending = vi.mocked(client.operators).mock.calls.at(-1)!;
    expect(pending[0].intent).toBe("normative_admission");
    expect(screen.getByRole("status", { name: "Normative Method availability" }).textContent).toContain("Checking actual Method admission");
    expect(screen.getByRole("button", { name: "Download reviewed operator receipt" }).hasAttribute("disabled")).toBe(false);
    expect(props.onValidityChange).toHaveBeenLastCalledWith(true);
    if (change === "draft") {
      await user.selectOptions(screen.getByRole("combobox", { name: "Quantifier over activations" }), "some");
      expect(screen.getByRole("button", { name: "Check normative Method availability" }).hasAttribute("disabled")).toBe(true);
      await run(user);
    } else if (change === "cancel") {
      await user.click(screen.getByRole("button", { name: "Cancel Method availability check" }));
    } else if (change === "workspace") {
      rerender(<Bpic19Operators {...props} workspaceId="workspace.v1:another-fixture" />);
    } else {
      const identity = { ...operatorIdentity, [change === "source" ? "source_id" : "population_id"]: `${change === "source" ? "source" : "population"}.v1:sha256:${"f".repeat(64)}` };
      rerender(<Bpic19Operators {...props} identity={identity} />);
    }
    await waitFor(() => expect(props.onReviewed).toHaveBeenCalledTimes(change === "cancel" ? 1 : 2));
    expect(pending[1].aborted).toBe(true);
    const reviewed = props.onReviewed.mock.calls.at(-1)![0];
    const validityCount = props.onValidityChange.mock.calls.length;
    await act(async () => {
      if (delivery === "error") reject!(new Error("obsolete network error"));
      else resolve!(delivery === "success" ? answering(pending[0]) : { ok: false, problem: { kind: "refusal", refusal: {
        schema_version: 1, message_type: "bpic19_operator_refusal", request_id: pending[0].request_id, query_revision: pending[0].query_revision, workspace_id: pending[0].workspace_id,
        operation: "bpic19_operators", code: "method_binding_unavailable", message: "OBSOLETE Method refusal", field: "intent", retryable: false,
        method_context: { intent: "normative_admission", identity: pending[0].identity, query: pending[0].query, definition_id: operatorAnswer(pending[0]).definition_id },
      } } });
    });
    const status = screen.queryByRole("status", { name: "Normative Method availability" });
    expect(status?.textContent ?? "").toBe(change === "cancel" ? "Method availability check cancelled. Descriptive evidence remains usable." : "");
    expect(screen.queryByRole("alert", { name: "Normative Method availability" })).toBeNull();
    expect(props.onValidityChange.mock.calls).toHaveLength(validityCount);
    expect(props.onValidityChange).toHaveBeenLastCalledWith(true);
    expect(props.onReviewed).toHaveBeenLastCalledWith(reviewed);
    expect(screen.getByRole("button", { name: "Download reviewed operator receipt" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Keep truth false items" }).hasAttribute("disabled")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Retain reviewed result for comparison and saving" }));
    expect(props.onRetain).toHaveBeenLastCalledWith(reviewed);
  });
});

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
  it("labels cancellation exclusions hypothetical and inspects the complete original history", async () => {
    const { user, props, client } = setup();
    await waitFor(() => expect(vi.mocked(client.operators)).toHaveBeenCalledTimes(1));
    await user.selectOptions(screen.getByRole("combobox", { name: "Recorded-event operator" }), "cancellation");
    expect(screen.getByText(/Receipt exclusion is a hypothetical analytical view/)).toBeTruthy();
    expect(screen.getByText(/every clearing record is retained/)).toBeTruthy();
    await run(user);
    await user.click(screen.getByText(/Item b · evaluated · 5 original records/));
    expect(screen.getByText(/Hypothetically excluded receipt targets:/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Inspect complete item b" }));
    const answer = operatorAnswer(vi.mocked(client.operators).mock.calls.at(-1)![0]);
    expect(props.onInspect).toHaveBeenLastCalledWith("b", answer.cases.find(value => value.case_id === "b")!.record_row_ids);
  });
  it.each(["incompatible_clock", "incompatible_horizon"])("shows named %s operator refusal without publishing a current answer", async code => {
    const client: Bpic19OperatorClient = { operators: vi.fn(async (request): Promise<Bpic19OperatorOutcome> => request.query.recipe === null ? answering(request) : { ok: false, problem: { kind: "refusal", refusal: {
      schema_version: 1, message_type: "bpic19_operator_refusal", request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id,
      operation: "bpic19_operators", code, message: "Review the declared operator horizon; no conversion or clipping was substituted.", field: "query.recipe.horizon_end", retryable: false,
    } } }) };
    const { user, props } = setup(client);
    await waitFor(() => expect(vi.mocked(client.operators)).toHaveBeenCalledTimes(1));
    await user.selectOptions(screen.getByRole("combobox", { name: "Recorded-event operator" }), "waiting");
    await user.click(screen.getByRole("button", { name: "Review and run operator" }));
    expect((await screen.findByRole("alert")).textContent).toContain(code);
    expect(props.onReviewed).not.toHaveBeenCalled();
    expect(props.onValidityChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("button", { name: "Download reviewed operator receipt" })).toBeNull();
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

// Workspace integration at the real coordinator and HTTP-client seams. The seven
// source headers and saved recipe are independent frozen input, not a purchasing
// profile. HTTP answers here are presentation fixtures, not analytical proof.


const reachabilityColumns = ["case", "activity", "time", "eventID", "category", "value", "note"].map((name, index) => ({ name, index }));
const reachabilitySupport = { case_ids: ["C", "N", "T", "E", "U"], case_count: 5, record_count: 13 };
const reachabilityQuery: OperatorQuery = {"limit": 20, "offset": 0, "policy_id": "bpic19.declared_operators.v1", "recipe": {"flow_scope": "after_gr", "kind": "rule", "left_activities": ["A"], "position": "eventual", "quantifier": "every", "relation": "response", "reuse": "allow", "right_activities": ["B"], "ties": "allow_equal", "vacuity": "not_activated"}, "roles": {"event_id": 3, "item_category": 4, "net_worth": 5}};
const reachabilitySource = "source.v1:sha256:1ed35b9d9afab39841d8b4561f93f90cbe0350bbb0820f654c36c8d28eb4d74c";
// Frozen original row identities; this only formats controlled HTTP replies.
const reachabilityRows = [
  "row.v1:sha256:993c5999ee1bb0b56ea1403df5172919eddfb85a05011408a9e50c12d0adf643",
  "row.v1:sha256:67848f2f3fcc55e5f851a1cdc3670b176ee2a35576393d7ef70596175d1b0b9f",
  "row.v1:sha256:8f22c0c4e701fcfc7cce79c2930f3a5bd80cf20701d162832fa1026c566f24f2",
  "row.v1:sha256:55f68616c04eadd70443ecceeadd39625921cc7810494a35790750c3da466852",
  "row.v1:sha256:323013c3104751ea2782775bde9e5f5e3e47a8a81a198486abcff8782f3452cf",
  "row.v1:sha256:7616a9e07254317a1092d93773eff39aeffba01def916be3c82f54b138388afe",
  "row.v1:sha256:378939a9c87863b54e8caa301224b8d44561c7115cdcbad1b78905656b34dfb0",
  "row.v1:sha256:6dd5299eef6620ed09e5641eac355f51321d2fe7625c376b73920652f1eaf63d",
  "row.v1:sha256:65044f0cb571dcdfe25a4a18f587535eaae037f63589ce470f11216a1411180c",
  "row.v1:sha256:d08215437a4be00c1938fbfa8e3467d29aadebf629267a971ff1880f9c0a82f6",
  "row.v1:sha256:bcf4ef6310706767a977db6d6532d0688505b4db7b180f891f59ef5fc3fe98a3",
  "row.v1:sha256:a077323efe2adf3788b444d37a7ade62f3f9644e0408119b917687fec05a0da9",
  "row.v1:sha256:f88cc6c365f35c5a4f4ade3ddbc75836c34c5e84986bb13e1e5c5044aebfeb1f",
];
const sourceRows = (...positions: number[]) => positions.map(position => reachabilityRows[position]);
const reachabilityCases: Bpic19OperatorAnswer["cases"] = [
  {
    case_id: "C",
    state: "unknown",
    reason: "conflicting_case_attribute",
    record_count: 3,
    record_row_ids: sourceRows(0, 1, 2),
    observations: [
    ],
    unmatched_row_ids: [],
    included_row_ids: [],
    excluded_row_ids: [],
    unknown_row_ids: [],
    totals: {},
    truth: "unknown",
    activation_count: 1,
    known_activation_count: 1,
  },
  {
    case_id: "N",
    state: "evaluated",
    reason: null,
    record_count: 4,
    record_row_ids: sourceRows(3, 4, 5, 6),
    observations: [
      {
        ordinal: 1,
        state: "matched",
        reason: null,
        activation_row_ids: sourceRows(3),
        response_row_ids: sourceRows(4),
        candidate_row_ids: sourceRows(4),
        unknown_row_ids: [],
        truth: "true",
        intervals: {},
        start: null,
        end: null,
        native_invoice_id: null,
        observation_id: "bpic19-observation.v1:sha256:a8dd14ba9558c50bfe11a2bc8459a747163718969b7c476bfc33b872691de728",
        selected_row_ids: sourceRows(3, 4),
      },
      {
        ordinal: 2,
        state: "unmatched",
        reason: "no_recorded_partner",
        activation_row_ids: sourceRows(5),
        response_row_ids: [],
        candidate_row_ids: [],
        unknown_row_ids: [],
        truth: "false",
        intervals: {},
        start: null,
        end: null,
        native_invoice_id: null,
        observation_id: "bpic19-observation.v1:sha256:e138cc5c7867d3143076ff7e36401fb4d1449f717ba0c78d4f36951f1c27bd32",
        selected_row_ids: sourceRows(5),
      },
    ],
    unmatched_row_ids: sourceRows(5),
    included_row_ids: sourceRows(3, 4),
    excluded_row_ids: [],
    unknown_row_ids: [],
    totals: {},
    truth: "false",
    activation_count: 2,
    known_activation_count: 2,
  },
  {
    case_id: "T",
    state: "evaluated",
    reason: null,
    record_count: 3,
    record_row_ids: sourceRows(7, 8, 9),
    observations: [
      {
        ordinal: 1,
        state: "matched",
        reason: null,
        activation_row_ids: sourceRows(8),
        response_row_ids: sourceRows(7),
        candidate_row_ids: sourceRows(7, 9),
        unknown_row_ids: [],
        truth: "true",
        intervals: {},
        start: null,
        end: null,
        native_invoice_id: null,
        observation_id: "bpic19-observation.v1:sha256:39cb25cd0fc6879dbd91b6dca00e2db5f0755445ceaaa29bee3a2ca7d045071b",
        selected_row_ids: sourceRows(8, 7),
      },
    ],
    unmatched_row_ids: [],
    included_row_ids: sourceRows(8, 7),
    excluded_row_ids: [],
    unknown_row_ids: [],
    totals: {},
    truth: "true",
    activation_count: 1,
    known_activation_count: 1,
  },
  {
    case_id: "E",
    state: "not_activated",
    reason: "no_known_activation",
    record_count: 1,
    record_row_ids: sourceRows(10),
    observations: [
    ],
    unmatched_row_ids: [],
    included_row_ids: [],
    excluded_row_ids: [],
    unknown_row_ids: [],
    totals: {},
    truth: null,
    activation_count: 0,
    known_activation_count: 0,
  },
  {
    case_id: "U",
    state: "unknown",
    reason: "unknown_rule_support",
    record_count: 2,
    record_row_ids: sourceRows(11, 12),
    observations: [
      {
        ordinal: 1,
        state: "unknown",
        reason: "potential_unknown_partner",
        activation_row_ids: sourceRows(11),
        response_row_ids: [],
        candidate_row_ids: [],
        unknown_row_ids: sourceRows(12),
        truth: "unknown",
        intervals: {},
        start: null,
        end: null,
        native_invoice_id: null,
        observation_id: "bpic19-observation.v1:sha256:452fa0bb537bc781190dccd3cf94ea145462200ced8a05f39b27556522c3ff02",
        selected_row_ids: sourceRows(11),
      },
    ],
    unmatched_row_ids: [],
    included_row_ids: [],
    excluded_row_ids: [],
    unknown_row_ids: sourceRows(12),
    totals: {},
    truth: "unknown",
    activation_count: 1,
    known_activation_count: 1,
  },
];

function reachabilityAnswer(request: Bpic19OperatorRequest): Bpic19OperatorAnswer {
  const answer = operatorAnswer(request);
  return { ...answer, parent_identity: request.identity,
    catalogue: { columns: reachabilityColumns, activities: ["A", "B", "Change Price"], clock_kind: "wall_clock", trusted_cutoff: "2018-01-10T00:00:00" },
    population_case_count: 5, population_record_count: 13,
    summary: { case_state_counts: { evaluated: 2, unknown: 2, not_activated: 1 }, observation_state_counts: { matched: 2, unmatched: 1, unknown: 1 },
      truth_case_counts: { true: 1, false: 1, unknown: 2 }, activation_count: 5, known_activation_count: 5, observation_count: 4,
      interval_distributions: {}, total_distributions: {}, occupancy: null },
    selection_groups: [
      { key: "truth_false", label: "truth false", case_ids: ["N"], case_count: 1, record_count: 4 },
      { key: "truth_true", label: "truth true", case_ids: ["T"], case_count: 1, record_count: 3 },
      { key: "unknown", label: "unknown", case_ids: ["C", "U"], case_count: 2, record_count: 5 },
      { key: "not_activated", label: "not activated", case_ids: ["E"], case_count: 1, record_count: 1 },
    ], cases: request.query.recipe ? structuredClone(reachabilityCases) : [], offset: 0, limit: request.query.limit, next_offset: null,
  };
}
function unavailableMethod(request: Bpic19OperatorRequest) {
  const body = { schema_version: 1, message_type: "bpic19_operator_refusal", request_id: request.request_id,
    query_revision: request.query_revision, workspace_id: request.workspace_id, operation: "bpic19_operators",
    code: "method_binding_unavailable", message: "This recorded-event rule has no admitted actual Method binding for normative grading.", field: "intent", retryable: false,
    method_context: { intent: "normative_admission", identity: request.identity, query: request.query, definition_id: reachabilityAnswer(request).definition_id } };
  expect(bpic19OperatorContract.refusal(body)).toBe(true);
  return new Response(JSON.stringify(body), { status: 409 });
}
const reachabilityActive: { stop(): void }[] = [];
afterEach(() => { for (const coordinator of reachabilityActive.splice(0)) coordinator.stop(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function openReachability(saved = false, profileUnavailable = false, deferMethod = false) {
  const imports = scriptedImportClient(), selections = scriptedSelectionClient(), saves = scriptedSavingClient();
  const investigation = new ImportedInvestigationCoordinator(imports.client, selections.client, scriptedViewClient().client);
  const comparison = new CompareCoordinator(scriptedComparisonClient().client), session = new Bpic19Session();
  const saving = new SavingCoordinator(saves.client, investigation, undefined, undefined, session);
  reachabilityActive.push(investigation, comparison, saving);
  const requests: Bpic19OperatorRequest[] = [];
  const pendingMethod: { request: Bpic19OperatorRequest; signal: AbortSignal | null | undefined; reply: (response: Response) => void }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    const raw: unknown = JSON.parse(String(init?.body));
    if (url === "/api/investigations/bpic19-profile" && bpic19ProfileContract.request(raw)) {
      if (profileUnavailable) return new Response("{}", { status: 503 });
      const answer = { ...raw, message_type: "bpic19_profile_answer", parent_identity: raw.identity,
        binding_state: "needs_review", columns: reachabilityColumns.map(column => ({ ...column, mapped_context: column.index > 2 })),
        suggested_roles: { item_category: null, item_type: null, goods_receipt: null, gr_based_iv: null, purchasing_document: null, item: null, source_case: null }, profile: null };
      expect(bpic19ProfileContract.answer(answer)).toBe(true);
      return new Response(JSON.stringify(answer), { status: 200 });
    }
    if (url === "/api/investigations/bpic19-measures" && bpic19MeasuresContract.request(raw)) {
      // Supply the independent counts boundary too: default invoice labels are
      // absent from these original A/B/Change Price rows. No amount/flow role is bound.
      const answer = { ...measuresAnswer(raw), parent_identity: raw.identity, population_case_count: 5, population_record_count: 13,
        flow_case_counts: { unknown: 5 }, summaries: {}, cases: [],
        activity_cohorts: { positive_case_ids: [], zero_case_ids: reachabilitySupport.case_ids, unavailable_case_ids: [],
          presence_positive_case_ids: [], presence_absent_case_ids: reachabilitySupport.case_ids, presence_unknown_case_ids: [],
          repeated_positive_case_ids: [], repeated_absent_case_ids: reachabilitySupport.case_ids, repeated_unknown_case_ids: [],
          population_case_count: 5, presence_fraction: 0, repeated_presence_fraction: 0, denominator: 5, reason: null },
        representation_groups: { exact: [], first_occurrence: [] }, representation_unavailable_case_ids: [], value_bands: [], value_band_unavailable_case_ids: [] };
      expect(bpic19MeasuresContract.answer(answer)).toBe(true);
      return new Response(JSON.stringify(answer), { status: 200 });
    }
    if (url === "/api/investigations/bpic19-operators" && bpic19OperatorContract.request(raw)) {
      requests.push(structuredClone(raw));
      if (raw.intent === "normative_admission") {
        if (deferMethod) return new Promise<Response>(reply => pendingMethod.push({ request: raw, signal: init?.signal, reply }));
        return unavailableMethod(raw);
      }
      const answer = reachabilityAnswer(raw);
      expect(bpic19OperatorContract.answer(answer)).toBe(true);
      return new Response(JSON.stringify(answer), { status: 200 });
    }
    throw new Error("Only source proposal, counts and operator HTTP boundaries are admitted");
  }));
  async function answerPopulation(index: number) {
  await act(async () => {
    const call = imports.populations[index], answer = populationAnswer(call.request);
    answer.identity.source_id = reachabilitySource; answer.source.source_id = reachabilitySource; answer.source.filename = "literal.csv";
    answer.preparation.source_id = reachabilitySource;
    answer.preparation.mapping.context_columns = [3, 4, 5, 6];
    answer.preparation.policies.time = { id: "incident.time.wall_clock_as_recorded.v1", parameters: { format: "iso8601", timezone: "none_as_recorded", snapshot_cutoff_local: "2018-01-10T00:00:00" } };
    answer.population = reachabilitySupport; answer.coverage = { raw_record_count: 13, mapped_record_count: 13, omitted_activity_record_count: 0 };
    answer.unassigned_record_count = 0;
    answer.cases = reachabilityCases.map(item => ({ case_id: item.case_id, record_count: item.record_count, mapped_record_count: item.record_count, omitted_activity_record_count: 0, sequence_evaluable: item.case_id !== "U" }));
    call.reply({ ok: true, answer }); await Promise.resolve(); await Promise.resolve();
    const selection = selections.selections[index];
    selection.reply({ ok: true, answer: { ...selectionAnswer(selection.request, { ...everyIncident, kept: reachabilitySupport }), parent: reachabilitySupport } });
    await Promise.resolve(); await Promise.resolve();
    const graph = selections.graphs[index]; graph.reply({ ok: true, answer: graphAnswer(graph.request, reachabilitySupport.case_ids) });
  });
  }
  investigation.open({ workspaceId, preparationId });
  await answerPopulation(0);
  if (saved) {
    const current = investigation.getState(), selected = shownSelection(current.selection)!;
    if (current.population.phase !== "ready") throw new Error("Current source must be ready");
    const frozen: SavedBinding = { investigationId: "investigation.v1:11111111111141118111111111111111", revisionId: firstRevisionId,
      content: { ...savedContent, base_identity: current.population.answer.identity, selection_identity: selected.answer.identity,
        selection_recipe: { parent_case_ids: reachabilitySupport.case_ids, predicates: [] }, comparison: null,
        bpic19_pipeline: { schema_version: 1, actions: [{ operation: "bpic19_rule", identity: selected.answer.identity,
          selection_prefix_length: 0, query: { ...reachabilityQuery }, definition_id: operatorAnswer({ schema_version: 1, message_type: "bpic19_operator_request", request_id: "frozen", query_revision: 1, workspace_id: workspaceId, identity: selected.answer.identity, query: reachabilityQuery }).definition_id }] } } };
    let reopening: Promise<boolean> | undefined;
    await act(async () => { reopening = saving.reopen({ ...savedSummary, latest_revision_id: firstRevisionId }, workspaceId); });
    const call = saves.reopens[0], reply = reopenAnswer(call.request);
    reply.revision.content = frozen.content; reply.restored_comparison_id = null;
    reply.restored_selection = { identity: selected.answer.identity, parent_identity: selected.answer.parent_identity,
      parent: reachabilitySupport, kept: reachabilitySupport, removed: { case_ids: [], case_count: 0, record_count: 0 },
      unevaluable: { case_ids: [], case_count: 0, record_count: 0 }, predicate_results: [] };
    await act(async () => { call.reply({ ok: true, answer: reply }); });
    expect(await reopening).toBe(true);
    await answerPopulation(1);
  }
  const props = { investigation, comparison, saving, session, active: true, onShowData: vi.fn(), onShowComparison: vi.fn() };
  const view = render(<Bpic19Workspace {...props} />);
  await screen.findByRole("button", { name: profileUnavailable ? "Retry source profile" : "Review these field roles" });
  return { ...view, ...props, imports, selections, saves, requests, pendingMethod, answerPopulation, user: userEvent.setup() };
}

describe("Workspace operator reachability without a purchasing profile", () => {
  it("replays the saved recorded rule and its authoritative original roles without a six-role profile", async () => {
    const app = await openReachability(true);
    expect(screen.getByRole("button", { name: "Review these field roles" }).hasAttribute("disabled")).toBe(true);
    expect(await screen.findByRole("heading", { name: "Review recorded-event matching and waiting" })).toBeTruthy();
    await screen.findByRole("table", { name: "Complete-item cohorts · observation groups can overlap" });
    expect(screen.getByRole("combobox", { name: "Original eventID field" })).toHaveProperty("value", "3");
    expect(screen.getByRole("combobox", { name: "Invariant item category field" })).toHaveProperty("value", "4");
    expect(screen.getByRole("combobox", { name: "Original source-EUR amount field" })).toHaveProperty("value", "5");
    expect(app.requests.filter(request => request.query.recipe !== null).every(request => JSON.stringify(request.query) === JSON.stringify(reachabilityQuery))).toBe(true);
    await waitFor(() => expect(screen.getByRole("button", { name: /^Save$/ }).hasAttribute("disabled")).toBe(false));
    expect(app.session.savedPipeline()?.actions.filter(action => action.operation === "bpic19_rule")).toMatchObject([{ operation: "bpic19_rule", query: reachabilityQuery }]);
    await app.user.selectOptions(screen.getByRole("combobox", { name: "Quantifier over activations" }), "some");
    expect(screen.getByRole("button", { name: /^Save$/ }).hasAttribute("disabled")).toBe(true);
    act(() => { app.saving.save("Unreviewed draft", "Must not save", "incidents"); });
    expect(app.saves.saves).toHaveLength(0);
    await app.user.click(screen.getByRole("button", { name: "Restore reviewed operator" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Save$/ }).hasAttribute("disabled")).toBe(false));
    const evidence = screen.getByRole("table", { name: "Complete-item cohorts · observation groups can overlap" }).textContent;
    await app.user.click(screen.getByRole("button", { name: "Check normative Method availability" }));
    expect((await screen.findByRole("status", { name: "Normative Method availability" })).textContent).toContain("method_binding_unavailable");
    expect(app.requests.at(-1)).toMatchObject({ intent: "normative_admission", query: reachabilityQuery });
    expect(screen.getByRole("table", { name: "Complete-item cohorts · observation groups can overlap" }).textContent).toBe(evidence);
    expect(screen.getByRole("button", { name: "Download reviewed operator receipt" }).hasAttribute("disabled")).toBe(false);
    await app.user.click(screen.getByRole("button", { name: /^Save$/ }));
    await app.user.click(screen.getByRole("button", { name: "Save revision" }));
    expect(app.saves.saves).toHaveLength(1);
    const saved = app.saves.saves[0];
    expect(saved.request.bpic19_pipeline?.actions.find(action => action.operation === "bpic19_rule")?.query).toEqual(reachabilityQuery);
    const reply = saveAnswer(saved.request, secondRevisionId, false);
    reply.revision.content.bpic19_pipeline = structuredClone(saved.request.bpic19_pipeline);
    await act(async () => { saved.reply({ ok: true, answer: reply }); });
    expect(app.investigation.getState().saved?.revisionId).toBe(secondRevisionId);
    expect(screen.queryByRole("button", { name: "Review completion and inclusion cohorts" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Evaluate purchasing criteria and priorities" })).toBeNull();
  });
  it("opens a fresh catalogue with explicit unmapped roles even while the purchasing profile is unavailable", async () => {
    const app = await openReachability(false, true);
    await app.user.click(screen.getByRole("button", { name: "Review invoice matches, recorded rules and waiting intervals" }));
    const eventId = await screen.findByRole("combobox", { name: "Original eventID field" });
    await waitFor(() => expect(within(eventId).getAllByRole("option")).toHaveLength(8));
    expect(app.requests).toHaveLength(1);
    expect(app.requests[0].query).toMatchObject({ recipe: null, roles: { event_id: null, item_category: null, net_worth: null } });
    for (const label of ["Original eventID field", "Invariant item category field", "Original source-EUR amount field"]) {
      expect(screen.getByRole("combobox", { name: label })).toHaveProperty("value", "");
    }
    expect(within(eventId).getByRole("option", { name: "6: note" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review and run operator" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Review completion and inclusion cohorts" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Evaluate purchasing criteria and priorities" })).toBeNull();
  });

  it("cancels a Method check and fences its old refusal after a semantic preparation change", async () => {
    const app = await openReachability(true, false, true);
    await screen.findByRole("table", { name: "Complete-item cohorts · observation groups can overlap" });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Save$/ }).hasAttribute("disabled")).toBe(false));
    await app.user.click(screen.getByRole("button", { name: "Check normative Method availability" }));
    await app.user.click(screen.getByRole("button", { name: "Cancel Method availability check" }));
    expect(app.pendingMethod[0].signal?.aborted).toBe(true);
    await act(async () => { app.pendingMethod[0].reply(unavailableMethod(app.pendingMethod[0].request)); });
    expect(screen.getByRole("status", { name: "Normative Method availability" }).textContent).toContain("cancelled");
    expect(screen.getByRole("button", { name: /^Save$/ }).hasAttribute("disabled")).toBe(false);
    await app.user.click(screen.getByRole("button", { name: "Check normative Method availability" }));
    await act(async () => { app.investigation.open({ workspaceId, preparationId: earlierPreparationId }); });
    expect(screen.getByRole("button", { name: /^Save$/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("heading", { name: "Review recorded-event matching and waiting" }).closest(".bpic19-main")?.hasAttribute("inert")).toBe(true);
    await app.answerPopulation(2);
    expect(app.pendingMethod[1].signal?.aborted).toBe(true);
    await app.user.click(await screen.findByRole("button", { name: "Review invoice matches, recorded rules and waiting intervals" }));
    await waitFor(() => expect(app.requests.at(-1)?.identity.preparation_id).toBe(earlierPreparationId));
    expect(app.requests.at(-1)?.query).toMatchObject({ recipe: null, roles: { event_id: 3, item_category: null, net_worth: null } });
    await act(async () => { app.pendingMethod[1].reply(unavailableMethod(app.pendingMethod[1].request)); });
    expect(screen.queryByRole("status", { name: "Normative Method availability" })).toBeNull();
    expect(screen.queryByRole("table", { name: "Complete-item cohorts · observation groups can overlap" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Invariant item category field" })).toHaveProperty("value", "");
  });

});
