import {expect,it} from "vitest";
import fixture from "./profile-test-answer.json";
import {bpic19ProfileContract} from "./profile-client";
import {profileKeepAction} from "./profile-keep";
import type {Bpic19GroupRecipe} from "./profile-types";
import type {CaseIdIn} from "../generated/selection";

if(!bpic19ProfileContract.answer(fixture) || !fixture.profile)throw new Error("Literal profile fixture");
const answer=fixture;
const ids:[string,...string[]]=["B_1","D1_2","F_1","G_1"];
function recipe():Bpic19GroupRecipe{
  if(!answer.profile)throw new Error("Literal reviewed profile");
  return {source_identity:structuredClone(answer.identity),definition_id:answer.profile.definition_id,
    definition:structuredClone(answer.profile.definition),query:structuredClone(answer.query),
    group:{kind:"flow",flow_id:"before_gr"},case_ids:[...ids]};
}
const predicate:CaseIdIn={kind:"case_id_in",case_ids:ids,negate:false};
it("admits the exact reviewed typed before group and stores no duplicate IDs or interpretation",()=>{
  const action=profileKeepAction(answer,recipe(),predicate,0);
  expect(action?.selection_keep).toEqual({policy_id:"bpic19.profile_group_keep.v1",step_index:0,group:{kind:"flow",flow_id:"before_gr"}});
  expect(action?.query).toEqual(answer.query);expect(action?.identity).toEqual(answer.identity);
  expect(action?.selection_prefix_length).toBe(0);
  expect(profileKeepAction(answer,recipe(),predicate,0,null)?.selection_prefix_length).toBeNull();
});
it("refuses mismatching source/definition/query/group/full membership and unknown descriptors",()=>{
  for(const change of [(r:Bpic19GroupRecipe)=>{r.source_identity.population_id="foreign";},
    (r:Bpic19GroupRecipe)=>{r.definition_id="foreign";},(r:Bpic19GroupRecipe)=>{r.definition.category_labels.before_gr="wrong";},
    (r:Bpic19GroupRecipe)=>{r.query.roles=null;},(r:Bpic19GroupRecipe)=>{r.group.flow_id="consignment";},
    (r:Bpic19GroupRecipe)=>{r.case_ids=["D2_1"];},(r:Bpic19GroupRecipe)=>{r.group.state="invented";}]){
    const chosen=recipe();change(chosen);expect(profileKeepAction(answer,chosen,predicate,0)).toBeNull();
  }
  expect(profileKeepAction(answer,recipe(),{...predicate,case_ids:["D1_2"]},0)).toBeNull();
  expect(profileKeepAction(answer,recipe(),{...predicate,negate:true},0)).toBeNull();
});
