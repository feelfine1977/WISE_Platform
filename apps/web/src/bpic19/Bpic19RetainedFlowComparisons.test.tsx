import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Bpic19PipelineAction } from "../generated/saving";
import type { Bpic19FlowComparisonAnswer, Bpic19FlowComparisonRequest } from "../generated/bpic19-flow-comparison";
import fixture from "./flow-comparison-test-answer.json";
import { Bpic19FlowComparison } from "./Bpic19FlowComparison";
import { Bpic19RetainedFlowComparisons, retainedFlowComparisonRequest, type RecordedFlowReturn } from "./Bpic19RetainedFlowComparisons";
import { bpic19FlowComparisonContract, type Bpic19FlowComparisonClient, type Bpic19FlowComparisonOutcome } from "./flow-comparison-client";

function literal(): Bpic19FlowComparisonAnswer {
  const data: unknown = structuredClone(fixture);
  if (!bpic19FlowComparisonContract.answer(data)) throw new Error("Independent count/witness fixture must satisfy its boundary");
  return data;
}
function action(): Bpic19PipelineAction {
  const data = literal();
  return { operation: "bpic19_flow_comparison", identity: data.identity, query: {...data.query},
    definition_id: data.definition_id, selection_prefix_length: 1 };
}
function answer(request: Bpic19FlowComparisonRequest): Bpic19FlowComparisonAnswer {
  const data = literal();
  data.request_id = request.request_id; data.query_revision = request.query_revision;
  data.workspace_id = request.workspace_id; data.identity = structuredClone(request.identity);
  data.parent_identity = structuredClone(request.identity); data.query = structuredClone(request.query);
  data.comparison.page = { ...request.query.page, total: 1, next_offset: null, items: request.query.page.role === "reference" ? data.comparison.page.items : [{
    case_id: request.query.page.role === "target" ? "D1_3" : "Z_1", role: request.query.page.role,
    document: request.query.page.role === "target" ? "D1" : "Z", item_type_state: request.query.page.role === "target" ? "invariant" : "missing",
    item_type_value: request.query.page.role === "target" ? "Standard" : null, record_count: 1,
    witness_row_ids: ["row.v1:sha256:" + "b".repeat(64)],
    reason: request.query.page.role === "target" ? "exact_invariant_flow_and_subtype" : "subtype_missing_or_conflicting",
  }] };
  return data;
}
function props(client: Bpic19FlowComparisonClient = {compare: async request => ({ok: true, answer: answer(request)})}) {
  const declared = action(), data = literal();
  return { workspaceId: data.workspace_id, baseIdentity: data.identity,
    currentIdentity: {...data.identity, population_id: "population.v1:sha256:" + "9".repeat(64)},
    actions: [declared], revision: 4, client, onInspect: vi.fn(), onReturnParent: vi.fn((_action: Bpic19PipelineAction): RecordedFlowReturn => ({ok: true})) };
}
async function choose() {
  const user = userEvent.setup();
  await user.click(screen.getByText(/Reviewed and retained flow comparisons/));
  await user.selectOptions(screen.getByRole("combobox", {name: "Retained flow comparison"}), "0");
  return user;
}

describe("recorded flow comparison admission and evidence", () => {
  it("reads both immutable sides and literal original witnesses without Keep, Swap or publication callbacks", async () => {
    const requests: Bpic19FlowComparisonRequest[] = [];
    const p = props({compare: async request => {requests.push(request); return {ok: true, answer: answer(request)};}});
    const before = structuredClone(p.actions); render(<Bpic19RetainedFlowComparisons {...p}/>);
    const user = await choose(); await screen.findByRole("table", {name: "Comparison complete-item evidence"});
    expect(requests[0].identity).toEqual(before[0].identity);
    expect(requests[0].query).toEqual(before[0].query);
    expect(screen.getByText(/Target item share: 50% of 2 union items; target record share: 33.33% of 3/)).toBeTruthy();
    expect(screen.getByText(/Distinct union documents: 1; documents in both sides: 1 \(D1\)/)).toBeTruthy();
    expect(screen.queryByRole("button", {name: /Keep|Swap|Review comparison roles/})).toBeNull();
    const inspect = screen.getByRole("button", {name: "Inspect comparison item D1_1"}); inspect.focus(); await user.keyboard("{Enter}");
    expect(p.onInspect).toHaveBeenLastCalledWith(before[0].identity, "D1_1", [
      "row.v1:sha256:dc3f474a0d1773c79ba98162891fadfe022d2e5dd91ba25bcaadcee5ecf5dc87",
      "row.v1:sha256:c64e0e21a62d268654b3488322c750244820824e07eb2b3bcea1be62e808a347",
    ], `Recorded comparator · flow comparison ${before[0].definition_id}`);
    await user.selectOptions(screen.getByRole("combobox", {name: "Evidence side"}), "target");
    await user.click(await screen.findByRole("button", {name: "Inspect comparison item D1_3"}));
    expect(p.onInspect).toHaveBeenLastCalledWith(before[0].identity, "D1_3", ["row.v1:sha256:" + "b".repeat(64)], `Recorded target · flow comparison ${before[0].definition_id}`);
    expect(requests[1].identity).toEqual(before[0].identity);
    expect(requests[1].query.target).toEqual(requests[0].query.target);
    expect(requests[1].query.reference).toEqual(requests[0].query.reference);
    expect(p.actions).toEqual(before);
  });

  it("keeps an explicitly refused null-prefix return readable under the prepared identity", async () => {
    const p = props(); p.actions[0].selection_prefix_length = null;
    p.onReturnParent = vi.fn((_action: Bpic19PipelineAction): RecordedFlowReturn => ({ok: false, message: "The exact source parent has no selectable prefix; no equal-member alias was used."}));
    const frozen = structuredClone(p.actions); render(<Bpic19RetainedFlowComparisons {...p}/>); const user = await choose();
    await screen.findByRole("table", {name: "Comparison complete-item evidence"});
    await user.click(screen.getByRole("button", {name: "Return to purchasing parent"}));
    expect(screen.getByRole("alert").textContent).toContain("no equal-member alias");
    expect(p.onReturnParent).toHaveBeenCalledWith(frozen[0]);
    await user.click(screen.getByRole("button", {name: "Inspect comparison item D1_1"}));
    expect(p.onInspect.mock.calls[0][0]).toEqual(frozen[0].identity);
    expect(p.actions).toEqual(frozen);
  });

  it.each(["definition", "identity", "query"])("refuses a returned %s that differs from the recorded declaration", async field => {
    const p = props({compare: async request => {
      const a = answer(request);
      if (field === "definition") {a.definition_id = "another-definition"; a.comparison.definition_id = "another-definition";}
      if (field === "identity") a.identity = {...a.identity, population_id: "population.v1:sha256:" + "0".repeat(64)};
      if (field === "query") a.query = {...a.query, target: a.query.reference};
      return {ok: true, answer: a};
    }}); render(<Bpic19RetainedFlowComparisons {...p}/>); await choose();
    expect((await screen.findByRole("alert")).textContent).toContain("differs from the retained comparison");
    expect(screen.queryByRole("button", {name: /Inspect comparison item/})).toBeNull();
    expect(p.onInspect).not.toHaveBeenCalled();
  });

  it.each(["recipe", "preparation"])("refuses an unsupported retained %s without sending a replacement request", async kind => {
    const client: Bpic19FlowComparisonClient = {compare: vi.fn()}; const p = props(client);
    if (kind === "recipe") p.actions[0].query = {policy_id: "unknown"};
    else p.actions[0].identity = {...p.actions[0].identity, preparation_id: "preparation.v1:sha256:" + "a".repeat(64)};
    render(<Bpic19RetainedFlowComparisons {...p}/>); await choose();
    expect(screen.getByRole("alert").textContent).toContain("No current fields were substituted");
    expect(client.compare).not.toHaveBeenCalled();
  });

  it("requires the same recorded definition on a later evidence page", async () => {
    const p = props({compare: async request => {
      const a = answer(request);
      if (request.query.page.role === "target") {a.definition_id = "changed-page-definition"; a.comparison.definition_id = a.definition_id;}
      return {ok: true, answer: a};
    }}); render(<Bpic19RetainedFlowComparisons {...p}/>); const user = await choose();
    await screen.findByRole("table", {name: "Comparison complete-item evidence"});
    await user.selectOptions(screen.getByRole("combobox", {name: "Evidence side"}), "target");
    expect((await screen.findByRole("alert")).textContent).toContain("differs from the retained comparison");
    expect(screen.getByRole("button", {name: "Inspect comparison item D1_1"}).hasAttribute("disabled")).toBe(true);
    expect(p.onInspect).not.toHaveBeenCalled();
  });

  it.each(["success", "error"])("drops a late %s when the source/current selection changes", async kind => {
    let release: ((outcome: Bpic19FlowComparisonOutcome) => void) | undefined;
    const client: Bpic19FlowComparisonClient = {compare: vi.fn((): Promise<Bpic19FlowComparisonOutcome> => new Promise(resolve => {release = resolve;}))};
    const p = props(client); const view = render(<Bpic19RetainedFlowComparisons {...p}/>); await choose();
    const [asked, signal] = vi.mocked(client.compare).mock.calls[0];
    view.rerender(<Bpic19RetainedFlowComparisons {...p} currentIdentity={{...p.currentIdentity, population_id: "next-selection"}} revision={5}/>);
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole("button", {name: /Inspect comparison item/})).toBeNull();
    await act(async () => {release?.(kind === "success" ? {ok: true, answer: answer(asked)} : {ok: false, problem: {kind: "unreachable"}});});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("table", {name: "Comparison complete-item evidence"})).toBeNull();
    expect(p.onInspect).not.toHaveBeenCalled();
  });

  it("isolates readOnly validity and review callbacks", async () => {
    const data = literal(); const reviewed = vi.fn(), valid = vi.fn();
    render(<Bpic19FlowComparison workspaceId={data.workspace_id} identity={data.identity} revision={1}
      query={data.query} client={{compare: async request => ({ok: true, answer: answer(request)})}} readOnly
      onReviewed={reviewed} onValidityChange={valid} onInspect={vi.fn()}/>);
    await screen.findByRole("table", {name: "Comparison complete-item evidence"});
    expect(reviewed).not.toHaveBeenCalled(); expect(valid).not.toHaveBeenCalled();
  });

  it("requires the recorded definition when restoring an editable current comparison", async () => {
    const data = literal(), reviewed = vi.fn(), valid = vi.fn();
    render(<Bpic19FlowComparison workspaceId={data.workspace_id} identity={data.identity} revision={1}
      query={data.query} recordedDefinitionId={data.definition_id} client={{compare: async request => {
        const wrong = answer(request); wrong.definition_id = "unrecorded-current-definition";
        wrong.comparison.definition_id = wrong.definition_id; return {ok: true, answer: wrong};
      }}} onReviewed={reviewed} onValidityChange={valid} onInspect={vi.fn()}/>);
    expect((await screen.findByRole("alert")).textContent).toContain("differs from the recorded comparison");
    expect(screen.queryByRole("button", {name: /Inspect comparison item/})).toBeNull();
    expect(reviewed).not.toHaveBeenCalled(); expect(valid).toHaveBeenLastCalledWith(false);
  });

  it("cancels a pending retained read and never publishes its late witnesses", async () => {
    let release: ((outcome: Bpic19FlowComparisonOutcome) => void) | undefined;
    const client: Bpic19FlowComparisonClient = {compare: vi.fn((): Promise<Bpic19FlowComparisonOutcome> => new Promise(resolve => {release = resolve;}))};
    const p = props(client); render(<Bpic19RetainedFlowComparisons {...p}/>); const user = await choose();
    const [asked, signal] = vi.mocked(client.compare).mock.calls[0];
    await user.click(screen.getByRole("button", {name: "Cancel comparison"}));
    expect(signal.aborted).toBe(true);
    await act(async () => {release?.({ok: true, answer: answer(asked)});});
    expect(screen.queryByRole("button", {name: /Inspect comparison item/})).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("cancelled");
    expect(p.onInspect).not.toHaveBeenCalled();
  });

  it("does not admit a malformed action via a current-field fallback", () => {
    const bad = action(); bad.query = {unexpected: "not executable"};
    expect(retainedFlowComparisonRequest(literal().workspace_id, bad)).toBeNull();
  });
});
