import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Bpic19CohortsRequest, Bpic19CohortsAnswer } from "../generated/bpic19-cohorts";
import fixture from "./cohorts-test-answer.json";
import { Bpic19Cohorts, type Bpic19CohortComparison } from "./Bpic19Cohorts";
import { cohortsContract, type CohortsClient, type CohortsOutcome } from "./cohorts-client";

if (!cohortsContract.answer(fixture)) throw new Error("Bad literal cohort fixture");
const answer: Bpic19CohortsAnswer = fixture;
const endingId="bpic19-cohorts.v1:sha256:"+"a".repeat(64);
const endingQuery={...answer.query,completion:{...answer.query.completion,recipe:"kpmg_last_ending" as const}};
function respond(request: Bpic19CohortsRequest): CohortsOutcome {
  const { page: _page, ...definition } = request.query;
  const given:Bpic19CohortsAnswer={ ...answer, request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id, identity: request.identity, query: request.query, definition,
    cohorts: { ...answer.cohorts, definition } };
  if(request.query.completion.recipe==="kpmg_last_ending") {
    // Independent J9 oracle: K has bad time, P has a later Change, Q ends in Delete,
    // T has unordered equal-time Clear/Change. Literal groups are not production-derived.
    given.definition_id=endingId;given.cohorts={...given.cohorts,definition_id:endingId,completion_groups:[
      {state:"observed_closed",case_ids:["L","Q"],case_count:2,record_count:3,document_count:2,document_unknown_case_count:0},
      {state:"open_recorded",case_ids:["P","R","S"],case_count:3,record_count:4,document_count:3,document_unknown_case_count:0},
      {state:"unknown",case_ids:["K","Missing","T","U"],case_count:4,record_count:6,document_count:4,document_unknown_case_count:0},
    ]};
  }
  return {ok:true,answer:given};
}
function props(client: CohortsClient = { cohorts: vi.fn(async request => respond(request)) }) {
  return { workspaceId: answer.workspace_id, identity: answer.identity, revision: 1, roles: answer.query.roles, timestampKind: "wall_clock" as const,
    onInspect: vi.fn(), onKeepCases: vi.fn(), onReviewed: vi.fn(), onValidityChange: vi.fn(), client };
}

describe("recorded completion cohorts", () => {
  it("explicitly retains presence and ending on one parent and re-reads both exact definitions for a named pair",async()=>{
    const p=props(),onRetain=vi.fn(),onCompared=vi.fn(),onComparisonValidityChange=vi.fn();
    render(<Bpic19Cohorts {...p} onRetain={onRetain} onCompared={onCompared} onComparisonValidityChange={onComparisonValidityChange}/>);
    const user=userEvent.setup();await screen.findByRole("button",{name:"Retain reviewed cohort"});
    await user.click(screen.getByRole("button",{name:"Retain reviewed cohort"}));
    expect(onRetain.mock.calls[0][0].definition_id).toBe(answer.definition_id);
    await user.click(screen.getByText("Inclusion and completion definition"));
    await user.selectOptions(screen.getByRole("combobox",{name:"Recorded-completion recipe"}),"kpmg_last_ending");
    expect(screen.getByRole("button",{name:"Retain reviewed cohort"}).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button",{name:"Review this cohort"}));
    await waitFor(()=>expect(p.onReviewed.mock.lastCall?.[0].definition_id).toBe(endingId));
    await user.click(screen.getByRole("button",{name:"Retain reviewed cohort"}));
    expect(onRetain).toHaveBeenCalledTimes(2);
    await user.click(screen.getByText("Compare two retained completion definitions on this parent"));
    await user.selectOptions(screen.getByRole("combobox",{name:"Target retained completion definition"}),answer.definition_id);
    await user.selectOptions(screen.getByRole("combobox",{name:"Comparator retained completion definition"}),endingId);
    await user.click(screen.getByRole("button",{name:"Review paired completion definitions"}));
    const table=await screen.findByRole("table",{name:"Two reviewed same-parent completion answers"});
    expect(within(within(table).getByRole("row",{name:/Target: Flow presence/})).getAllByRole("cell").slice(1,4).map(cell=>cell.textContent)).toEqual(["4","3","2"]);
    expect(within(within(table).getByRole("row",{name:/Comparator: KPMG last Clear\/Delete/})).getAllByRole("cell").slice(1,4).map(cell=>cell.textContent)).toEqual(["2","3","4"]);
    expect(onCompared).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({policy_id:"bpic19.same_parent_completion_comparison.v1",identity:p.identity,
      target:expect.objectContaining({definition_id:answer.definition_id,query:answer.query}),reference:expect.objectContaining({definition_id:endingId,query:endingQuery})}));
    expect(onComparisonValidityChange).toHaveBeenLastCalledWith(true);
    await user.selectOptions(screen.getByRole("combobox",{name:"Retain for analysis"}),"unknown");
    expect(onComparisonValidityChange).toHaveBeenLastCalledWith(false);
    expect(table.closest("div")?.dataset.stale).toBe("true");
    await user.selectOptions(screen.getByRole("combobox",{name:"Previously retained cohort"}),answer.definition_id);
    await user.click(screen.getByRole("button",{name:"Read retained cohort"}));
    await waitFor(()=>expect(p.onReviewed.mock.lastCall?.[0].definition_id).toBe(answer.definition_id));
    expect(p.onReviewed.mock.lastCall?.[0].query).toEqual(answer.query);
    await user.click(screen.getByRole("button",{name:"Restore reviewed completion comparison"}));
    await waitFor(()=>expect(onComparisonValidityChange).toHaveBeenLastCalledWith(true));
    expect(onCompared).toHaveBeenCalledTimes(2);
  });
  it("restores a declared pair exactly and refuses a wrong saved definition without selecting defaults",async()=>{
    const p=props(),onCompared=vi.fn(),onComparisonValidityChange=vi.fn();
    const pair:Bpic19CohortComparison={policy_id:"bpic19.same_parent_completion_comparison.v1",identity:p.identity,
      target:{name:"Saved presence",definition_id:answer.definition_id,query:answer.query},reference:{name:"Saved ending",definition_id:endingId,query:endingQuery}};
    const view=render(<Bpic19Cohorts {...p} restoredComparison={pair} onCompared={onCompared} onComparisonValidityChange={onComparisonValidityChange}/>);
    await screen.findByRole("table",{name:"Two reviewed same-parent completion answers"});
    expect(onCompared).toHaveBeenCalledExactlyOnceWith(pair);
    view.rerender(<Bpic19Cohorts {...p} restoredComparison={{...pair,reference:{...pair.reference,definition_id:"bpic19-cohorts.v1:sha256:"+"f".repeat(64)}}} onCompared={onCompared} onComparisonValidityChange={onComparisonValidityChange}/>);
    await screen.findByText(/A cohort differs from its retained source, parent or definition/);
    expect(onCompared).toHaveBeenCalledTimes(1);expect(onComparisonValidityChange).toHaveBeenLastCalledWith(false);
  });
  it.each(["success","error"])("fences a delayed retained pair %s after the source population changes",async outcome=>{
    const pending:Array<{request:Bpic19CohortsRequest;resolve:(value:CohortsOutcome)=>void;signal:AbortSignal}>=[];
    const client:CohortsClient={cohorts:vi.fn((request,signal)=>request.request_id.startsWith("cohort-pair-")
      ?new Promise<CohortsOutcome>(resolve=>pending.push({request,resolve,signal})):Promise.resolve(respond(request)))};
    const p=props(client),onCompared=vi.fn();
    const retainedQueries=[{definition_id:answer.definition_id,label:"Presence",query:answer.query},{definition_id:endingId,label:"Ending",query:endingQuery}];
    const view=render(<Bpic19Cohorts {...p} retainedQueries={retainedQueries} onCompared={onCompared}/>);const user=userEvent.setup();
    await screen.findByRole("table",{name:"Whole-item stages and recorded completion"});
    await user.click(screen.getByText("Compare two retained completion definitions on this parent"));
    await user.selectOptions(screen.getByRole("combobox",{name:"Target retained completion definition"}),answer.definition_id);
    await user.selectOptions(screen.getByRole("combobox",{name:"Comparator retained completion definition"}),endingId);
    await user.click(screen.getByRole("button",{name:"Review paired completion definitions"}));expect(pending).toHaveLength(2);
    view.rerender(<Bpic19Cohorts {...p} identity={{...p.identity,population_id:"population.v1:sha256:"+"f".repeat(64)}} revision={2} onCompared={onCompared}/>);
    await act(async()=>{for(const pendingRequest of pending)pendingRequest.resolve(outcome==="success"?respond(pendingRequest.request):{ok:false,problem:{kind:"unreachable"}});});
    expect(pending.every(value=>value.signal.aborted)).toBe(true);expect(onCompared).not.toHaveBeenCalled();
    expect(screen.queryByRole("table",{name:"Two reviewed same-parent completion answers"})).toBeNull();
  });
  it("cancels both paired reads while preserving the independent current cohort answer",async()=>{
    const pending:Array<{request:Bpic19CohortsRequest;resolve:(value:CohortsOutcome)=>void;signal:AbortSignal}>=[];
    const client:CohortsClient={cohorts:vi.fn((request,signal)=>request.request_id.startsWith("cohort-pair-")
      ?new Promise<CohortsOutcome>(resolve=>pending.push({request,resolve,signal})):Promise.resolve(respond(request)))};
    const p=props(client),onCompared=vi.fn(),onComparisonValidityChange=vi.fn();
    render(<Bpic19Cohorts {...p} retainedQueries={[{definition_id:answer.definition_id,label:"Presence",query:answer.query},{definition_id:endingId,label:"Ending",query:endingQuery}]} onCompared={onCompared} onComparisonValidityChange={onComparisonValidityChange}/>);
    const user=userEvent.setup();await screen.findByRole("table",{name:"Whole-item stages and recorded completion"});
    await user.click(screen.getByText("Compare two retained completion definitions on this parent"));
    await user.selectOptions(screen.getByRole("combobox",{name:"Target retained completion definition"}),answer.definition_id);
    await user.selectOptions(screen.getByRole("combobox",{name:"Comparator retained completion definition"}),endingId);
    await user.click(screen.getByRole("button",{name:"Review paired completion definitions"}));
    await user.click(screen.getByRole("button",{name:"Cancel completion comparison"}));
    expect(pending.every(value=>value.signal.aborted)).toBe(true);
    await act(async()=>{pending.forEach(value=>value.resolve(respond(value.request)));});
    expect(onCompared).not.toHaveBeenCalled();expect(onComparisonValidityChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button",{name:"Keep Recorded closed"}).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain("cancelled");
  });
  it("opens an unscored all-item question, presents exact states, keeps complete IDs and opens witness rows", async () => {
    const p=props();render(<Bpic19Cohorts {...p}/>);const user=userEvent.setup();
    await screen.findByRole("table",{name:"Whole-item stages and recorded completion"});
    expect(screen.getAllByText(/9 PO items · 13 original records/)).toHaveLength(3);
    await user.click(screen.getByRole("button",{name:"Keep Recorded closed"}));
    expect(p.onKeepCases).toHaveBeenCalledWith(["K","L","P","T"]);
    await user.click(screen.getByRole("button",{name:"Inspect K"}));
    const witness=answer.cohorts.page.items.find(i=>i.case_id==="K")!;
    expect(p.onInspect).toHaveBeenCalledWith("K",witness.witness_row_ids);
    expect(p.onReviewed).toHaveBeenCalled();expect(p.onValidityChange).toHaveBeenLastCalledWith(true);
    expect(screen.getAllByText(/Due assessment unavailable/).length).toBe(9);
  });
  it("pauses keeping and saving while a meaning-bearing definition is edited, then emits the exact reviewed query", async () => {
    const p=props();render(<Bpic19Cohorts {...p}/>);const user=userEvent.setup();
    await screen.findByRole("button",{name:"Keep Recorded closed"});
    await user.click(screen.getByText("Inclusion and completion definition"));
    await user.selectOptions(screen.getByLabelText("Retain for analysis"),"observed_closed");
    expect(screen.getByRole("button",{name:"Keep Recorded closed"}).hasAttribute("disabled")).toBe(true);
    expect(p.onValidityChange).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole("button",{name:"Review this cohort"}));
    await screen.findByRole("table",{name:"Whole-item stages and recorded completion"});
    expect(p.onReviewed.mock.lastCall?.[0].query.retain).toBe("observed_closed");
  });
  it("fences an old success and failure after the source/population revision changes", async () => {
    const pending: Array<{request:Bpic19CohortsRequest;resolve:(value:CohortsOutcome)=>void}>=[];
    const client:CohortsClient={cohorts:vi.fn(request=>new Promise<CohortsOutcome>(resolve=>pending.push({request,resolve})))};
    const p=props(client);const view=render(<Bpic19Cohorts {...p}/>);
    view.rerender(<Bpic19Cohorts {...p} revision={2}/>);
    pending[1].resolve(respond(pending[1].request));
    await screen.findByRole("table",{name:"Whole-item stages and recorded completion"});
    pending[0].resolve({ok:false,problem:{kind:"unreachable"}});
    expect(p.onReviewed).toHaveBeenCalledTimes(1);
    expect(p.onReviewed.mock.lastCall?.[0].query_revision).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("reports cancellation and an explicit retry without keeping the earlier answer", async () => {
    const client:CohortsClient={cohorts:vi.fn(()=>new Promise<CohortsOutcome>(()=>{}))};
    const p=props(client);render(<Bpic19Cohorts {...p}/>);const user=userEvent.setup();
    await user.click(screen.getByRole("button",{name:"Cancel cohort review"}));
    expect(screen.getByRole("alert").textContent).toContain("cancelled");
    expect(p.onValidityChange).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole("button",{name:"Retry cohort"}));
    expect(client.cohorts).toHaveBeenCalledTimes(2);
  });
});
