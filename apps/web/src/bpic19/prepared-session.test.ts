import {expect,it} from "vitest";
import fixture from "../test/prepared-api.json";
import {PreparedAssessmentSession} from "./prepared-session";
import type {PreparedReference} from "../generated/bpic19-prepared-runs";
const context={workspace_id:fixture.review.workspace_id,source_context_id:"declared-prepared",revision:1};
const reference=fixture.run.reference as PreparedReference;
it("revokes saving authority for edited or changed-context declarations without borrowing a raw selection identity",()=>{
  const session=new PreparedAssessmentSession();session.basis(context,true);
  expect(session.readyForSave()).toBe(true);
  session.changed();expect(session.readyForSave()).toBe(false);
  session.reviewed(reference.input_id);expect(session.retain(reference)).toBe(true);
  expect(session.savedPreparedAssessments()).toEqual([reference]);
  session.changed();expect(session.savedPreparedAssessments()).toBeUndefined();expect(session.readyForSave()).toBe(false);
  session.basis({...context,revision:2},true);
  expect(session.retain(reference)).toBe(false);
  expect(session.savedPreparedAssessments()).toBeUndefined();
});

it("retains at most the four distinct views of one input and never revives another input's references",()=>{
  const session=new PreparedAssessmentSession();session.basis(context,true);session.changed();session.reviewed(reference.input_id);
  for(const view of ["Finance","Logistics","Compliance","Automation"] as const)expect(session.retain({...reference,view})).toBe(true);
  expect(session.savedPreparedAssessments()?.map(item=>item.view)).toEqual(["Finance","Logistics","Compliance","Automation"]);
  expect(session.retain({...reference,view:"Finance"})).toBe(true);expect(session.savedPreparedAssessments()).toHaveLength(4);
  session.changed();session.reviewed("bpic19-prepared-input.v1:sha256:"+"f".repeat(64));
  expect(session.retain(reference)).toBe(false);expect(session.savedPreparedAssessments()).toBeUndefined();
});
