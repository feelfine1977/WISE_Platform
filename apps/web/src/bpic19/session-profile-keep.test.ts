import {expect,it} from "vitest";
import {Bpic19Session} from "./session";
import type {AnswerIdentity,Bpic19PipelineAction,Bpic19ProfileKeepGroup} from "../generated/saving";
import {identity,workspaceId} from "../test/imports";

const base=identity;
const at=(n:number):AnswerIdentity=>({...base,population_id:"population.v1:sha256:"+n.toString(16).padStart(64,"0")});
const first={kind:"case_id_in",case_ids:["C"],negate:false};
const second={kind:"contains_activity",activity:"Finish",negate:false};
const sameMembersDifferentIntent={kind:"record_attribute_in",column_index:3,values:["C"],negate:false};
function profile(parent:AnswerIdentity):Bpic19PipelineAction{return {operation:"bpic19_profile",identity:parent,query:{policy_id:"literal"},definition_id:"literal-profile"};}
function keep(parent:AnswerIdentity,position:number|null=0,group:Bpic19ProfileKeepGroup={kind:"flow",flow_id:"before_gr"}):Bpic19PipelineAction{
  return {...profile(parent),selection_prefix_length:position,selection_keep:{policy_id:"bpic19.profile_group_keep.v1",step_index:0,group}};
}

it.each([{parent:at(0),position:0},{parent:base,position:null}])("promotes exact successful child without duplicate ordinary parent output ($position)",({parent,position})=>{
  const session=new Bpic19Session();session.basis(workspaceId,parent,[],base);session.reviewed(profile(parent));
  expect(session.recordKeep(keep(parent,position),first)).toBe(true);
  expect(session.readyForSave()).toBe(false);
  expect(session.declarations().some(action=>action.selection_keep)).toBe(false);
  session.basis(workspaceId,at(1),[first],base);session.reviewed(profile(at(1)));
  const saved=session.savedPipeline()!;
  expect(saved.actions).toHaveLength(2);
  expect(saved.actions[0].selection_keep).toEqual({policy_id:"bpic19.profile_group_keep.v1",step_index:0,group:{kind:"flow",flow_id:"before_gr"}});
  expect(saved.actions[0].identity).toEqual(parent);
  expect(saved.actions[0].selection_prefix_length).toBe(position);
  expect(JSON.stringify(saved)).not.toContain('"predicate"'); // Membership is in the actual step, once.
});

it.each(["failed","cancelled","stay"])("discards a %s pending Keep before a later equal-membership step",()=>{
  const session=new Bpic19Session();session.basis(workspaceId,at(0),[],base);session.reviewed(profile(at(0)));
  expect(session.recordKeep(keep(at(0)),first)).toBe(true);
  session.discardPendingKeep();
  session.basis(workspaceId,at(1),[first],base);session.reviewed(profile(at(1)));
  expect(session.savedPipeline()!.actions.every(action=>action.selection_keep===undefined)).toBe(true);
});

it("Undo/remove strips association back to ordinary profile and does not attach it to new equal-member intent",()=>{
  const session=new Bpic19Session();session.basis(workspaceId,at(0),[],base);session.reviewed(profile(at(0)));
  session.recordKeep(keep(at(0)),first);session.basis(workspaceId,at(1),[first],base);session.reviewed(profile(at(1)));
  expect(session.savedPipeline()!.actions.some(action=>action.selection_keep)).toBe(true);
  session.basis(workspaceId,at(0),[],base);
  expect(session.savedPipeline()!.actions).toHaveLength(1);
  expect(session.savedPipeline()!.actions[0].selection_keep).toBeUndefined();
  session.basis(workspaceId,at(2),[sameMembersDifferentIntent],base);session.reviewed(profile(at(2)));
  expect(session.savedPipeline()!.actions.every(action=>action.selection_keep===undefined)).toBe(true);
});

it("same-length replacement cannot retain an unrelated prior typed origin",()=>{
  const session=new Bpic19Session();session.basis(workspaceId,at(0),[],base);session.reviewed(profile(at(0)));
  session.recordKeep(keep(at(0)),first);session.basis(workspaceId,at(1),[first],base);session.reviewed(profile(at(1)));
  session.basis(workspaceId,at(2),[sameMembersDifferentIntent],base);session.reviewed(profile(at(2)));
  expect(session.savedPipeline()!.actions.every(action=>action.selection_keep===undefined)).toBe(true);
});

it.each([{parent:at(0),position:0},{parent:base,position:null}])("restored $position association survives appending another legitimate step",({parent,position})=>{
  const session=new Bpic19Session();const declared=[keep(parent,position),{...profile(at(1)),selection_prefix_length:1}];
  expect(session.restore(workspaceId,at(1),[first],declared,base)).toBe(true);
  session.basis(workspaceId,at(2),[first,second],base);session.reviewed(profile(at(2)));
  expect(session.savedPipeline()!.actions[0]).toEqual(declared[0]);
  session.basis(workspaceId,at(0),[],base);
  expect(session.savedPipeline()!.actions.every(action=>action.selection_keep===undefined)).toBe(true);
});

it("does not alias source-base null to numeric empty selection zero or vice versa",()=>{
  const p0=new Bpic19Session();p0.basis(workspaceId,at(0),[],base);p0.reviewed(profile(at(0)));
  expect(p0.recordKeep(keep(at(0),null),first)).toBe(false);
  const b=new Bpic19Session();b.basis(workspaceId,base,[],base);b.reviewed(profile(base));
  expect(b.recordKeep(keep(base,0),first)).toBe(false);
  expect(b.restore(workspaceId,at(1),[first],[keep(base,0)],base)).toBe(false);
  expect(p0.restore(workspaceId,at(1),[first],[keep(at(0),null)],base)).toBe(false);
});

it("preserves distinct verified group associations but suppresses otherwise identical ordinary profile copies",()=>{
  const flow=keep(at(0));const subtype=keep(at(0),0,{kind:"flow_item_type",flow_id:"before_gr",state:"invariant",item_type_value:"Standard"});
  const session=new Bpic19Session();expect(session.restore(workspaceId,at(1),[first],[{...profile(at(0)),selection_prefix_length:0},flow,subtype],base)).toBe(true);
  expect(session.savedPipeline()!.actions).toEqual([flow,subtype]);
});

it("legacy actions never receive retroactive origin and source replacement clears a pending typed Keep",()=>{
  const session=new Bpic19Session();const legacy={...profile(at(0)),selection_prefix_length:0};
  expect(session.restore(workspaceId,at(1),[first],[legacy],base)).toBe(true);
  expect(session.savedPipeline()!.actions).toEqual([legacy]);
  session.basis(workspaceId,at(0),[],base);session.reviewed(profile(at(0)));session.recordKeep(keep(at(0)),first);
  const foreign={...at(0),preparation_id:"preparation.v1:sha256:"+"f".repeat(64)};
  session.basis(workspaceId,foreign,[],foreign);
  expect(session.readyForSave()).toBe(true);expect(session.savedPipeline()).toBeNull();
});


it("restores the reviewed origin for the actual retained history node, but never for a fresh equal-predicate branch",()=>{
  const session=new Bpic19Session();const parent:readonly unknown[]=[];const typedChild=[first];
  session.basis(workspaceId,at(0),parent,base);session.reviewed(profile(at(0)));
  session.recordKeep(keep(at(0)),first);session.basis(workspaceId,at(1),typedChild,base);session.reviewed(profile(at(1)));
  const original=session.savedPipeline()!.actions.filter(action=>action.selection_keep);
  session.basis(workspaceId,at(0),parent,base);
  expect(session.declarations().some(action=>action.selection_keep)).toBe(false);
  session.basis(workspaceId,at(1),typedChild,base);session.reviewed(profile(at(1)));
  expect(session.savedPipeline()!.actions.filter(action=>action.selection_keep)).toEqual(original);
  session.basis(workspaceId,at(0),parent,base);
  const manualChild=[first];session.basis(workspaceId,at(1),manualChild,base);session.reviewed(profile(at(1)));
  expect(session.declarations().some(action=>action.selection_keep)).toBe(false);
  session.basis(workspaceId,at(0),parent,base);session.basis(workspaceId,at(1),manualChild,base);session.reviewed(profile(at(1)));
  expect(session.declarations().some(action=>action.selection_keep)).toBe(false);
});

it("source replacement clears even a retained node's earlier origin",()=>{
  const session=new Bpic19Session();const parent:readonly unknown[]=[];const child=[first];
  session.basis(workspaceId,at(0),parent,base);session.reviewed(profile(at(0)));
  session.recordKeep(keep(at(0)),first);session.basis(workspaceId,at(1),child,base);session.reviewed(profile(at(1)));
  session.basis(workspaceId,at(0),parent,base);
  const foreign={...base,preparation_id:"preparation.v1:sha256:"+"f".repeat(64)};
  session.basis(workspaceId,foreign,[],foreign);
  session.basis(workspaceId,at(1),child,base);session.reviewed(profile(at(1)));
  expect(session.declarations().some(action=>action.selection_keep)).toBe(false);
});
