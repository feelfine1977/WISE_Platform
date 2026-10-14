import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SelectionSteps } from "./SelectionSteps";
import { noSteps, withStep, afterStep } from "./steps";
import { contains, follows, opened, closed, bothSteps, selectionAnswer, suppliedGraph, support } from "../test/selections";
import { identity } from "../test/imports";
import type { SelectionPredicate } from "../generated/selection";
import type { ImportedSelectionState } from "../imported/coordinator";

const full = withStep(withStep(noSteps, contains(opened)), follows(opened, closed));
function state(active = 2): ImportedSelectionState {
 const request = {schema_version:1 as const,message_type:"select_cases_request" as const,request_id:"trail-1",query_revision:4,workspace_id:"workspace-1",identity,parent_case_ids:null,predicates:[...full.present],active_step_count:active};
 const answer=selectionAnswer(request,bothSteps);
 // Literal two-incident fixture: first contains removes B, so its unknown sequence does not enter cumulative U.
 answer.step_results=[
 {step_number:1,predicate:contains(opened),kept:support(["A-1"],2),removed:support(["B-2"],1),unevaluable:support([],0)},
 {step_number:2,predicate:follows(opened,closed),kept:support(["A-1"],2),removed:support(["B-2"],1),unevaluable:support([],0)}];
 return {phase:"ready",revision:4,history:active===2?full:afterStep(full,active),shown:{revision:4,steps:full.present.slice(0,active),answer,graph:suppliedGraph(["A-1"])}};
}
function props(selection=state()) {return {selection,onRemove:vi.fn(),onClear:vi.fn(),onUndo:vi.fn(),onRedo:vi.fn(),onChoose:vi.fn(),onRetry:vi.fn(),onStay:vi.fn()};}

describe("the supplied cumulative step trail",()=>{
 it("shows short labels and kept counts, opens independent and cumulative details with the keyboard, and selects a prefix immediately",async()=>{
  const p=props();const user=userEvent.setup();render(<SelectionSteps {...p}/>);
  expect(screen.getAllByRole("button",{name:/incidents kept after step/})).toHaveLength(2);
  expect(Array.from(document.querySelectorAll("details"), (node) => node.open)).toEqual([false,false]);
  const details=screen.getByText("Details of step 2");details.focus();await user.keyboard("{Enter}");
  // jsdom does not implement native summary keyboard toggling; user activation uses the browser's native disclosure click.
  if(!details.closest("details")?.open) await user.click(details);
  const box=details.closest("details")!;
  expect(within(box).getByText("Not evaluable after step 2").nextElementSibling?.textContent).toBe("0 incidents · 0 records");
  expect(within(box).getByText("Not evaluable").nextElementSibling?.textContent).toBe("1 incident · 1 record");
  await user.click(screen.getByRole("button",{name:/^Show after step 1:/}));
  expect(p.onChoose).toHaveBeenCalledWith(1);
 });
 it("keeps later chips after selecting an earlier prefix and marks only the answered current one",()=>{
  render(<SelectionSteps {...props(state(1))}/>);
  const buttons=screen.getAllByRole("button",{name:/incidents kept after step/});
  expect(buttons[0].getAttribute("aria-current")).toBe("step");expect(buttons[1].getAttribute("aria-current")).toBeNull();
  expect(screen.getByText("Later step")).toBeTruthy();expect(screen.getByRole("button",{name:"Redo"}).hasAttribute("disabled")).toBe(false);
 });
 it("names long exact-number intents by count instead of listing them on a chip",()=>{
  const selection=state();if(selection.phase!=="ready")throw Error();const step:SelectionPredicate={kind:"case_id_in",case_ids:["CASE-0",...Array.from({length:999},(_,i)=>`CASE-${i+1}`)],negate:false};
  selection.shown.answer.step_results=[{...selection.shown.answer.step_results[0],predicate:step}];selection.shown.answer.predicate_results=[{...selection.shown.answer.predicate_results[0],predicate:step}];
  render(<SelectionSteps {...props(selection)}/>);expect(screen.getByRole("button",{name:/Keep 1,000 incident numbers/}).textContent).toContain("Keep 1,000 incident numbers");
  expect(screen.queryByRole("button",{name:/CASE-999/})).toBeNull();
 });
});
