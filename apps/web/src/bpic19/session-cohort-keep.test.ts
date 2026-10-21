import {expect,it} from "vitest";
import {Bpic19Session} from "./session";
import type {AnswerIdentity,Bpic19PipelineAction} from "../generated/saving";
import {identity,workspaceId} from "../test/imports";

// #108 T06-AC12: a kept completion stage is saved with its reviewed cohort definition; Undo returns to the flow parent.
const base=identity;
const at=(n:number):AnswerIdentity=>({...base,population_id:"population.v1:sha256:"+n.toString(16).padStart(64,"0")});
const closed={kind:"case_id_in",case_ids:["M","N"],negate:false};
function cohorts(parent:AnswerIdentity):Bpic19PipelineAction{return {operation:"bpic19_cohorts",identity:parent,query:{policy_id:"literal",retain:"observed_closed"},definition_id:"literal-cohorts"};}
function keep(parent:AnswerIdentity):Bpic19PipelineAction{
  return {...cohorts(parent),selection_prefix_length:0,selection_keep:{policy_id:"bpic19.completion_cohort_keep.v1",step_index:0,group:{kind:"completion_cohort",support:"retention_retained"}}};
}

it("saves a kept closed stage with its cohort definition and step, and Undo returns to the flow parent's cohorts",()=>{
  const session=new Bpic19Session();session.basis(workspaceId,at(0),[],base);session.reviewed(cohorts(at(0)));
  expect(session.recordKeep(keep(at(0)),closed)).toBe(true);
  session.basis(workspaceId,at(1),[closed],base);session.reviewed(cohorts(at(1)));
  expect(session.savedPipeline()!.actions[0]).toEqual(keep(at(0)));
  session.basis(workspaceId,at(0),[],base);
  const undone=session.savedPipeline()!;
  expect(undone.actions).toEqual([{...cohorts(at(0)),selection_prefix_length:0}]);
});
