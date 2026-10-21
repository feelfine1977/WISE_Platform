import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { Bpic19FlowComparisonAnswer, Bpic19FlowComparisonRequest } from "../generated/bpic19-flow-comparison";
import fixture from "./flow-comparison-test-answer.json";
import { Bpic19FlowComparison } from "./Bpic19FlowComparison";
import { bpic19FlowComparisonContract, type Bpic19FlowComparisonClient, type Bpic19FlowComparisonOutcome } from "./flow-comparison-client";

function initial():Bpic19FlowComparisonAnswer {
  const candidate:unknown=fixture;if(!bpic19FlowComparisonContract.answer(candidate))throw new Error("Independent literal comparison fixture violates its boundary");return candidate;
}
function answering(request:Bpic19FlowComparisonRequest):Bpic19FlowComparisonOutcome {
  const candidate:unknown={...structuredClone(fixture),request_id:request.request_id,query_revision:request.query_revision,workspace_id:request.workspace_id,identity:request.identity,query:request.query};
  if(!bpic19FlowComparisonContract.answer(candidate))throw new Error("Literal comparison response violates its boundary");
  return {ok:true,answer:candidate};
}
function props(client:Bpic19FlowComparisonClient={compare:async request=>answering(request)}) {
  const answer=initial();return {workspaceId:answer.workspace_id,identity:answer.identity,revision:1,query:answer.query,client,onInspect:vi.fn(),onKeepCases:vi.fn(),onReviewed:vi.fn(),onValidityChange:vi.fn()};
}

it("shows union/outside/unknown supports, distinct document overlap and item/record shares and opens exact comparator rows by keyboard",async()=>{
  const p=props();render(<Bpic19FlowComparison {...p}/>);const user=userEvent.setup();
  await screen.findByRole("table",{name:"Exact subgroup support and distinct denominators"});
  expect(screen.getByText(/Named union comparison parent: 2 items \/ 3 records/)).toBeTruthy();
  expect(screen.getByText(/Target item share: 50% of 2 union items; target record share: 33.33% of 3/)).toBeTruthy();
  expect(screen.getByText(/Distinct union documents: 1; documents in both sides: 1 \(D1\)/)).toBeTruthy();
  const inspect=screen.getByRole("button",{name:"Inspect comparison item D1_1"});inspect.focus();await user.keyboard("{Enter}");
  expect(p.onInspect).toHaveBeenCalledWith("D1_1",fixture.comparison.page.items[0].witness_row_ids);
  await user.click(screen.getByRole("button",{name:"Keep comparison item D1_1"}));expect(p.onKeepCases).toHaveBeenCalledWith(["D1_1"]);
  await user.click(screen.getByRole("button",{name:"Keep outside both sides in flow parent"}));expect(p.onKeepCases).toHaveBeenCalledWith(["Z_1"]);
  expect(p.onReviewed).toHaveBeenCalledTimes(1);
});

it("pauses earlier keep/save actions after a role swap until the new definition is reviewed",async()=>{
  const p=props();render(<Bpic19FlowComparison {...p}/>);const user=userEvent.setup();await screen.findByRole("table",{name:"Comparison complete-item evidence"});
  await user.click(screen.getByRole("button",{name:"Swap target and comparator"}));
  expect(screen.getByRole("button",{name:"Keep target"}).hasAttribute("disabled")).toBe(true);
  expect(p.onValidityChange).toHaveBeenLastCalledWith(false);
  expect(screen.getByText(/Comparison roles have changed/)).toBeTruthy();
});

it.each(["success","error"])("fences a delayed %s after the current parent revision changes",async kind=>{
  let release:((value:Bpic19FlowComparisonOutcome)=>void)|undefined;
  const client:Bpic19FlowComparisonClient={compare:vi.fn((request):Promise<Bpic19FlowComparisonOutcome>=>request.query_revision===1?new Promise(resolve=>{release=resolve;}):Promise.resolve(answering(request)))};
  const p=props(client);const view=render(<Bpic19FlowComparison {...p}/>);
  const old=vi.mocked(client.compare).mock.calls[0][0];view.rerender(<Bpic19FlowComparison {...p} revision={2}/>);
  await screen.findByRole("table",{name:"Comparison complete-item evidence"});
  await act(async()=>{release?.(kind==="success"?answering(old):{ok:false,problem:{kind:"unreachable"}});});
  expect(p.onReviewed).toHaveBeenCalledTimes(1);expect(p.onReviewed.mock.calls[0][0].query_revision).toBe(2);expect(screen.queryByRole("alert")).toBeNull();
});

it("cancels pending comparison and refuses to expose an old answer as current",async()=>{
  let release:((value:Bpic19FlowComparisonOutcome)=>void)|undefined;
  const client:Bpic19FlowComparisonClient={compare:vi.fn((request):Promise<Bpic19FlowComparisonOutcome>=>new Promise(resolve=>{release=resolve;}))};
  const p=props(client);render(<Bpic19FlowComparison {...p}/>);const user=userEvent.setup();
  const old=vi.mocked(client.compare).mock.calls[0];await user.click(screen.getByRole("button",{name:"Cancel comparison"}));
  expect(old[1].aborted).toBe(true);await act(async()=>{release?.(answering(old[0]));});
  expect(p.onReviewed).not.toHaveBeenCalled();expect(screen.getByRole("alert").textContent).toContain("cancelled");
});
