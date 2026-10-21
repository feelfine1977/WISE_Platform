import {expect,it} from "vitest";
import {SavingCoordinator} from "./coordinator";
import {ImportedInvestigationCoordinator} from "../imported/coordinator";
import {PreparedAssessmentSession} from "../bpic19/prepared-session";
import fixture from "../test/prepared-api.json";
import {populationAnswer,preparationId,scriptedImportClient,workspaceId} from "../test/imports";
import {everyIncident,graphAnswer,scriptedSelectionClient,selectionAnswer} from "../test/selections";
import {scriptedViewClient} from "../test/views";
import {firstRevisionId,saveAnswer,reopenAnswer,savedSummary,scriptedSavingClient} from "../test/saving";
import type {PreparedReference} from "../generated/bpic19-prepared-runs";
const tick=async()=>{await Promise.resolve();await Promise.resolve();};
async function opening(){
  const imports=scriptedImportClient(),selection=scriptedSelectionClient(),saves=scriptedSavingClient();
  const investigation=new ImportedInvestigationCoordinator(imports.client,selection.client,scriptedViewClient().client);
  const prepared=new PreparedAssessmentSession(investigation);prepared.start();
  const saving=new SavingCoordinator(saves.client,investigation,undefined,undefined,undefined,prepared);
  investigation.open({workspaceId,preparationId});
  imports.populations[0].reply({ok:true,answer:populationAnswer(imports.populations[0].request)});await tick();
  selection.selections[0].reply({ok:true,answer:selectionAnswer(selection.selections[0].request,everyIncident)});await tick();
  const graph=selection.graphs.at(-1)!;graph.reply({ok:true,answer:graphAnswer(graph.request,everyIncident.kept.case_ids)});await tick();
  const reference=fixture.run.reference as PreparedReference;
  prepared.changed();prepared.reviewed(reference.input_id);expect(prepared.retain(reference)).toBe(true);
  return {prepared,saving,saves,investigation,reference,imports,selection};
}
it("saves separately identified prepared references and refuses to publish an old Save after a declared edit",async()=>{
  const app=await opening();
  app.saving.save("Declared assessment alongside investigation","Independent prepared basis","incidents");
  const call=app.saves.saves[0];
  expect(call.request.bpic19_prepared_assessments).toEqual([app.reference]);
  expect(call.request.bpic19_pipeline).toBeUndefined();
  const answer=saveAnswer(call.request,firstRevisionId,true);answer.revision.content.bpic19_prepared_assessments=[app.reference];
  answer.bpic19_prepared_outputs={basis_kind:"declared_prepared_attributes",input_id:app.reference.input_id,assessment_item_ids:fixture.review.basis.assessment_item_ids,references:[app.reference]};
  app.prepared.changed();
  call.reply({ok:true,answer});await tick();
  expect(app.investigation.getState().saved).toBeNull();
  expect(app.saving.getState().save.phase).toBe("idle");
  expect(app.saving.draft(app.investigation.getState())).toMatchObject({ready:false});
});


it("refuses a reopened prepared manifest that belongs to different references",async()=>{
  const app=await opening();
  const request=app.saving.reopen(savedSummary,workspaceId),call=app.saves.reopens[0],answer=reopenAnswer(call.request);
  answer.revision.content.bpic19_prepared_assessments=[app.reference];
  answer.bpic19_prepared_outputs={basis_kind:"declared_prepared_attributes",input_id:app.reference.input_id,assessment_item_ids:fixture.review.basis.assessment_item_ids,references:[{...app.reference,view:"Automation"}]};
  call.reply({ok:true,answer});await tick();
  expect(await request).toBe(false);expect(app.saving.getState().reopen.phase).toBe("failed");
});

it("restores verified saved prepared references after the actual reopened reading is accepted without a scoring action",async()=>{
  const app=await opening();app.saving.save("Separate prepared basis","Stored Method references","incidents");
  const call=app.saves.saves[0],answer=saveAnswer(call.request,firstRevisionId,true);
  answer.revision.content.bpic19_prepared_assessments=[app.reference];
  answer.bpic19_prepared_outputs={basis_kind:"declared_prepared_attributes",input_id:app.reference.input_id,assessment_item_ids:fixture.review.basis.assessment_item_ids,references:[app.reference]};
  call.reply({ok:true,answer});await tick();
  expect(app.saving.verifiedExportReceipt()?.bpic19_prepared_outputs?.references).toEqual([app.reference]);
  app.prepared.discard();
  const asked=app.saving.reopen({...savedSummary,latest_revision_id:firstRevisionId},workspaceId),reopen=app.saves.reopens[0],reply=reopenAnswer(reopen.request);
  reply.revision=structuredClone(answer.revision);reply.bpic19_prepared_outputs=structuredClone(answer.bpic19_prepared_outputs);
  reply.restored_selection.identity=answer.revision.content.selection_identity;
  reopen.reply({ok:true,answer:reply});await tick();expect(await asked).toBe(true);
  const population=app.imports.populations[1];population.reply({ok:true,answer:populationAnswer(population.request)});await tick();
  const selected=app.selection.selections[1];selected.reply({ok:true,answer:selectionAnswer(selected.request,everyIncident)});await tick();
  const graph=app.selection.graphs.at(-1)!;graph.reply({ok:true,answer:graphAnswer(graph.request,everyIncident.kept.case_ids)});await tick();
  expect(app.prepared.savedPreparedAssessments()).toEqual([app.reference]);
  expect(app.saving.verifiedExportReceipt()?.bpic19_prepared_outputs?.references).toEqual([app.reference]);
});
