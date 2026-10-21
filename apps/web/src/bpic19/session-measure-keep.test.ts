import {expect,it} from "vitest";
import {Bpic19Session} from "./session";
import type {AnswerIdentity,Bpic19PipelineAction} from "../generated/saving";
import {identity,workspaceId} from "../test/imports";

// #107 T05-AC10: a kept activity cohort is saved with its reviewed measures definition and its step; Undo drops it.
const base=identity;
const at=(n:number):AnswerIdentity=>({...base,population_id:"population.v1:sha256:"+n.toString(16).padStart(64,"0")});
const keptA={kind:"case_id_in",case_ids:["A"],negate:false};
function measures(parent:AnswerIdentity):Bpic19PipelineAction{return {operation:"bpic19_measures",identity:parent,query:{policy_id:"literal",activity_operator:"presence"},definition_id:"literal-measures"};}
function keep(parent:AnswerIdentity):Bpic19PipelineAction{
  return {...measures(parent),selection_prefix_length:0,selection_keep:{policy_id:"bpic19.measure_cohort_keep.v1",step_index:0,group:{kind:"activity_cohort",cohort:"positive"}}};
}

it("saves a kept positive cohort with its measures definition and step, and Undo returns to the ordinary measures",()=>{
  const session=new Bpic19Session();session.basis(workspaceId,at(0),[],base);session.reviewed(measures(at(0)));
  expect(session.recordKeep(keep(at(0)),keptA)).toBe(true);
  expect(session.readyForSave()).toBe(false);
  session.basis(workspaceId,at(1),[keptA],base);session.reviewed(measures(at(1)));
  const saved=session.savedPipeline()!;
  expect(saved.actions[0]).toEqual(keep(at(0)));
  expect(saved.actions.filter(action=>action.selection_keep)).toHaveLength(1);
  session.basis(workspaceId,at(0),[],base);
  const undone=session.savedPipeline()!;
  expect(undone.actions).toHaveLength(1);
  expect(undone.actions[0].selection_keep).toBeUndefined();
  expect(undone.actions[0].identity).toEqual(at(0));
});

it("refuses a cohort Keep for measures that were not reviewed on the current parent",()=>{
  const session=new Bpic19Session();session.basis(workspaceId,at(0),[],base);
  expect(session.recordKeep(keep(at(0)),keptA)).toBe(false);
  session.reviewed(measures(at(0)));
  expect(session.recordKeep({...keep(at(0)),definition_id:"another-definition"},keptA)).toBe(false);
  expect(session.recordKeep(keep(at(2)),keptA)).toBe(false);
});
