import { expect, it } from "vitest";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { ExpectationCoordinator, shownRun } from "../expectation/coordinator";
import { SavingCoordinator } from "./coordinator";
import { savingContract } from "./client";
import { scriptedImportClient, identity, workspaceId, preparationId } from "../test/imports";
import { scriptedSelectionClient } from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { scriptedSavingClient, savedSummary, reopenAnswer } from "../test/saving";
import { scriptedScoringClient, scoringPopulationAnswer, scoringSelectionAnswer, scoringGraphAnswer, readyAnswer, runAnswer } from "../test/scoring";
import { definitionOf, emptyForm } from "../expectation/definition";

it.each(["stay", "retry"] as const)("retains an unsaved score on same-bound failure, then handles %s", async(action)=>{
 const imports=scriptedImportClient(), selecting=scriptedSelectionClient(), scoring=scriptedScoringClient(), saved=scriptedSavingClient();
 const investigation=new ImportedInvestigationCoordinator(imports.client,selecting.client,scriptedViewClient().client);
 const expectations=new ExpectationCoordinator(scoring.client,investigation);expectations.start();
 const saving=new SavingCoordinator(saved.client,investigation,undefined,expectations);
 const tick=async()=>{await Promise.resolve();await Promise.resolve();};
 investigation.open({workspaceId,preparationId});
 imports.populations[0].reply({ok:true,answer:scoringPopulationAnswer(imports.populations[0].request)});await tick();
 selecting.selections[0].reply({ok:true,answer:scoringSelectionAnswer(selecting.selections[0].request)});await tick();
 selecting.graphs[0].reply({ok:true,answer:scoringGraphAnswer(selecting.graphs[0].request)});await tick();
 const form={...emptyForm,name:"Original scored rule",owner:"Desk",sourceLabel:"Agreement",rationale:"Reviewed",start:"Eröffnet",response:"Geschlossen",target:"4",width:"2",reviewed:true};
 const definition=definitionOf(form,"utc_instant",1);if(!definition)throw Error("Complete definition");
 expectations.setForm(form);
 expectations.check({workspaceId,baseIdentity:identity,population:{name:"Original reading",identity}},definition);
 scoring.validations[0].reply({ok:true,answer:readyAnswer(scoring.validations[0].request)});await tick();
 expectations.score();const original=runAnswer(scoring.scores[0].request,definition);
 scoring.scores[0].reply({ok:true,answer:original});await tick();
 const before=expectations.savedReference();expect(before).not.toBeNull();
 const selected=investigation.getState().selection;
 if(selected.phase!=="ready")throw Error("Original selection is ready");
 const sameContent={...reopenAnswer({schema_version:1,message_type:"reopen_investigation_request",request_id:"shape",query_revision:1,workspace_id:workspaceId,saved_revision_id:savedSummary.latest_revision_id}).revision.content,
  name:"Already bound unscored revision",base_identity:identity,selection_identity:selected.shown.answer.identity,
  selection_recipe:{parent_case_ids:original.run.population.case_ids,predicates:[]},comparison:null,bookmarks:[],score_run_ref:null};
 investigation.markSaved({investigationId:savedSummary.investigation_id,revisionId:savedSummary.latest_revision_id,content:sameContent});
 const requested=saving.reopen(savedSummary,workspaceId);
 const call=saved.reopens[0];const answer=reopenAnswer(call.request);
 answer.revision.content=sameContent;
 const {identity: keptIdentity,parent_identity,parent,kept,removed,unevaluable,predicate_results}=selected.shown.answer;
 answer.restored_selection={identity:keptIdentity,parent_identity,parent,kept,removed,unevaluable,predicate_results};
 answer.restored_comparison_id=null;
 expect(savingContract.reopenAnswer(answer)).toBe(true);
 call.reply({ok:true,answer});await requested;await tick();
 expect(investigation.getState().replacement?.phase).toBe("running");
 imports.populations[1].reply({ok:false,problem:{kind:"unreachable"}});await tick();
 expect(investigation.getState().replacement?.phase).toBe("failed");
 const population=investigation.getState().population;
 expect(population.phase==="ready"&&population.answer.identity).toEqual(identity);
 expect(shownRun(expectations.getState().run)).toEqual(original.run);
 expect(expectations.savedReference()).toEqual(before);
 expect(expectations.getState().form).toEqual(form);
 if(action==="stay") {
  investigation.stay();await tick();
  expect(investigation.getState().replacement).toBeNull();
  expect(shownRun(expectations.getState().run)).toEqual(original.run);
  expect(expectations.savedReference()).toEqual(before);
 } else {
  investigation.retryPopulation();
  expect(investigation.getState().replacement?.phase).toBe("running");
  expect(shownRun(expectations.getState().run)).toEqual(original.run);
  const retry=imports.populations[2];
  retry.reply({ok:true,answer:scoringPopulationAnswer(retry.request)});await tick();
  expect(investigation.getState().replacement).toBeNull();
  expect(shownRun(expectations.getState().run)).toBeNull();
  expect(expectations.savedReference()).toBeNull();
 }
 expect([scoring.validations.length,scoring.scores.length]).toEqual([1,1]);
 expectations.stop();saving.stop();investigation.stop();
});
