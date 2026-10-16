import type { Bpic19ProfileAnswer } from "../generated/bpic19-profile";
import type { Bpic19PipelineAction } from "../generated/saving";
import type { SelectionPredicate } from "../generated/selection";
import { sameJson } from "../data/coordinator";
import { savingContract } from "../saved/client";
import type { Bpic19GroupRecipe } from "./profile-types";

/** Select only an already supplied finite profile support; never infer a group from IDs. */
function support(answer: Bpic19ProfileAnswer, group: Bpic19GroupRecipe["group"]) {
  const p=answer.profile;if(!p)return null;
  if(group.kind==="flow")return p.flows.find(row=>row.flow_id===group.flow_id) ?? null;
  if(group.kind==="flow_item_type")return p.flow_item_types.find(row=>row.flow_id===group.flow_id && row.item_type_state===group.state && row.item_type_value===group.item_type_value) ?? null;
  if(group.kind==="unresolved")return p.unresolved.find(row=>row.state===group.state) ?? null;
  if(group.kind==="cross_check")return p.cross_checks.find(row=>row.state===group.state) ?? null;
  if(group.kind==="grain_issue")return p.grain.identity_issues.find(row=>row.state===group.state) ?? null;
  if(group.kind==="source_inclusion")return group.state==="retained" && !p.source_review?.projection ? p.source_review?.retained ?? null : null;
  const view=p.attribute_view;
  return group.kind==="attribute_value" && view && view.column_index===group.column_index && view.selection?.value===group.value ? view.selection ?? null : null;
}

/** Bind a public Profile Keep intent to exactly this answer and selection step. */
export function profileKeepAction(answer:Bpic19ProfileAnswer, recipe:Bpic19GroupRecipe,
  predicate:SelectionPredicate, stepIndex:number, parentPosition:number|null=stepIndex):Bpic19PipelineAction | null {
  const p=answer.profile;
  if(!p || !sameJson(recipe.source_identity,answer.identity) || recipe.definition_id!==p.definition_id ||
      !sameJson(recipe.definition,p.definition) || !sameJson(recipe.query,answer.query) ||
      predicate.kind!=="case_id_in" || predicate.negate || !sameJson(recipe.case_ids,predicate.case_ids))return null;
  const selected=support(answer,recipe.group);
  if(!selected || !sameJson(selected.case_ids,predicate.case_ids))return null;
  const action={operation:"bpic19_profile",identity:answer.identity,definition_id:p.definition_id,query:answer.query,
    selection_prefix_length:parentPosition,selection_keep:{policy_id:"bpic19.profile_group_keep.v1",step_index:stepIndex,
      group:structuredClone(recipe.group)}};
  return savingContract.pipelineAction(action) ? action : null;
}
