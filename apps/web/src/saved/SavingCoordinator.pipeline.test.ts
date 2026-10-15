import { expect, it } from "vitest";
import { Bpic19Session } from "../bpic19/session";
import { ImportedInvestigationCoordinator, shownSelection } from "../imported/coordinator";
import { SavingCoordinator } from "./coordinator";
import { earlierPreparationId, identity, populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { everyIncident, graphAnswer, scriptedSelectionClient, selectionAnswer } from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { firstRevisionId, reopenAnswer, saveAnswer, savedSummary, savingRefusal, scriptedSavingClient } from "../test/saving";
import type { Bpic19PipelineOutput } from "../generated/saving";

const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

async function exportFixture() {
  const imports = scriptedImportClient(), selection = scriptedSelectionClient(), saves = scriptedSavingClient();
  const investigation = new ImportedInvestigationCoordinator(imports.client, selection.client, scriptedViewClient().client);
  const session = new Bpic19Session();
  const saving = new SavingCoordinator(saves.client, investigation, undefined, undefined, session);
  const answerReading = async (index: number) => {
    imports.populations[index].reply({ ok: true, answer: populationAnswer(imports.populations[index].request) }); await tick();
    const call = selection.selections[index];
    call.reply({ ok: true, answer: selectionAnswer(call.request, everyIncident) }); await tick();
    selection.graphs.at(-1)!.reply({ ok: true, answer: graphAnswer(selection.graphs.at(-1)!.request, everyIncident.kept.case_ids) }); await tick();
  };
  investigation.open({ workspaceId, preparationId }); await answerReading(0);
  const state = investigation.getState();
  if (state.population.phase !== "ready") throw new Error("Source fixture did not open");
  const selected = shownSelection(state.selection)!.answer.identity;
  session.basis(workspaceId, selected, [], state.population.answer.identity);
  const action = { operation: "bpic19_profile" as const, identity: selected, selection_prefix_length: 0,
    query: { policy_id: "literal" }, definition_id: "definition-A" };
  const measured = { ...action, operation: "bpic19_measures" as const, definition_id: "literal-measure-definition" };
  // An independently declared saved order differs from the default operation list.
  session.restore(workspaceId, selected, [], [measured, action], state.population.answer.identity);
  saving.save("Frozen export receipt", "Saved notes, not a new draft", "incidents");
  const answer = saveAnswer(saves.saves[0].request, firstRevisionId, true);
  answer.revision.content.bpic19_pipeline = saves.saves[0].request.bpic19_pipeline;
  const output = (entry: typeof measured | typeof action, index: number) => ({ operation: entry.operation,
    definition_id: entry.definition_id, sha256: String(index + 1).repeat(64),
    output: { literal_original_item_ids: ["A-1", "B-2"], literal_original_row_ids: ["r1", "r2", "r3"] } });
  answer.bpic19_outputs = { schema_version: 1, outputs: [output(measured, 0), output(action, 1)] };
  saves.saves[0].reply({ ok: true, answer }); await tick();
  const reopened = (index: number) => {
    const call = saves.reopens[index], reply = reopenAnswer(call.request);
    reply.revision = structuredClone(answer.revision);
    reply.restored_selection = { ...reply.restored_selection, identity: selected,
      kept: { case_ids: ["A-1", "B-2"], case_count: 2, record_count: 3 },
      removed: { case_ids: [], case_count: 0, record_count: 0 }, predicate_results: [] };
    reply.bpic19_outputs = structuredClone(answer.bpic19_outputs);
    return reply;
  };
  const summary = { ...savedSummary, latest_revision_id: firstRevisionId, selected_case_count: 2, selected_record_count: 3 };
  return { imports, selection, saves, investigation, session, saving, action, answer, selected, summary, reopened, answerReading };
}

it("retains the immutable verified reopen receipt after the save form is idle without another save or scoring request", async () => {
  const app = await exportFixture();
  const original = structuredClone(app.saving.verifiedExportReceipt());
  app.saving.clearSave();
  expect(app.saving.getState().save.phase).toBe("idle");
  expect(app.saving.verifiedExportReceipt()).toEqual(original);
  expect(app.session.savedPipeline()?.actions.map(action => action.operation)).toEqual(["bpic19_measures", "bpic19_profile"]);
  const request = app.saving.reopen(app.summary, workspaceId);
  expect(app.saving.verifiedExportReceipt()).toBeNull();
  app.saves.reopens[0].reply({ ok: true, answer: app.reopened(0) }); await tick();
  expect(await request).toBe(true);
  expect(app.saving.verifiedExportReceipt()).toBeNull(); // Source/selection replay is still pending.
  await app.answerReading(1);
  app.session.restore(workspaceId, app.selected, [], app.answer.revision.content.bpic19_pipeline!.actions,
    app.answer.revision.content.base_identity);
  expect(app.saving.getState().save.phase).toBe("idle");
  expect(app.saving.verifiedExportReceipt()).toEqual(original);
  app.saving.clearSave();
  expect(app.saving.verifiedExportReceipt()).toEqual(original);
  expect(app.saves.saves).toHaveLength(1);
  expect(app.saves.reopens).toHaveLength(1);
  app.saving.stop(); app.investigation.stop();
});

it.each(["dirty", "different-pipeline", "selection", "preparation", "workspace"] as const)(
  "does not export the previous verified result after a %s change", async change => {
    const app = await exportFixture();
    expect(app.saving.verifiedExportReceipt()).not.toBeNull();
    if (change === "dirty") app.session.valid("bpic19_profile", false);
    else if (change === "different-pipeline") app.session.reviewed({ ...app.action, definition_id: "definition-B" });
    else if (change === "selection") app.investigation.addStep({ kind: "case_id_in", case_ids: ["A-1"], negate: false });
    else {
      app.investigation.open({ workspaceId: change === "workspace" ? "workspace.v1:fedcba9876543210" : workspaceId,
        preparationId: change === "preparation" ? earlierPreparationId : preparationId });
      expect(app.saving.verifiedExportReceipt()).toBeNull();
      await app.answerReading(1);
    }
    expect(app.saving.verifiedExportReceipt()).toBeNull();
    if (change === "preparation" || change === "workspace") {
      // Returning to old IDs cannot resurrect a receipt cleared by another reading.
      app.investigation.open({ workspaceId, preparationId }); await app.answerReading(2);
      app.investigation.markSaved({ investigationId: app.answer.revision.investigation_id,
        revisionId: app.answer.revision.saved_revision_id, content: app.answer.revision.content });
      expect(app.saving.verifiedExportReceipt()).toBeNull();
    }
    expect(app.saves.saves).toHaveLength(1);
    app.saving.stop(); app.investigation.stop();
  },
);

it.each(["artifact-refusal", "metadata-only-reply"] as const)(
  "never replaces pending/current export with stale callbacks or a %s", async failure => {
    const app = await exportFixture();
    const stale = app.saving.reopen(app.summary, workspaceId);
    const current = app.saving.reopen(app.summary, workspaceId);
    expect(app.saves.reopens[0].signal.aborted).toBe(true);
    app.saves.reopens[0].reply({ ok: true, answer: app.reopened(0) }); await tick();
    expect(await stale).toBe(false);
    expect(app.saving.verifiedExportReceipt()).toBeNull();
    const call = app.saves.reopens[1];
    call.reply(failure === "artifact-refusal" ? savingRefusal(call.request, "reopen_investigation", "artifact_unavailable", "An unvisited native chunk is unavailable") :
      { ok: false, problem: { kind: "unsupported_reply", detail: "Historical metadata-only recovery is not a verified reopened analytical result." } });
    await tick(); expect(await current).toBe(false);
    expect(app.saving.getState().reopen.phase).toBe("failed");
    expect(app.saving.verifiedExportReceipt()).toBeNull();
    app.saving.clearSave();
    expect(app.saving.verifiedExportReceipt()).toBeNull();
    expect(app.saves.saves).toHaveLength(1);
    app.saving.stop(); app.investigation.stop();
  },
);

it.each(["dirty", "new-definition"] as const)("does not bind a late save after the purchasing definition is %s", async change => {
  const imports = scriptedImportClient(), selection = scriptedSelectionClient(), saves = scriptedSavingClient();
  const investigation = new ImportedInvestigationCoordinator(imports.client, selection.client, scriptedViewClient().client);
  const session = new Bpic19Session();
  const saving = new SavingCoordinator(saves.client, investigation, undefined, undefined, session);
  investigation.open({ workspaceId, preparationId });
  imports.populations[0].reply({ ok: true, answer: populationAnswer(imports.populations[0].request) }); await tick();
  selection.selections[0].reply({ ok: true, answer: selectionAnswer(selection.selections[0].request, everyIncident) }); await tick();
  selection.graphs[0].reply({ ok: true, answer: graphAnswer(selection.graphs[0].request, everyIncident.kept.case_ids) }); await tick();
  const selected = shownSelection(investigation.getState().selection)!.answer.identity;
  session.basis(workspaceId, selected);
  const action = { operation: "bpic19_profile" as const, identity: selected, query: { policy_id: "literal" }, definition_id: "definition-A" };
  session.reviewed(action);
  saving.save("Reviewed A", "", "incidents");
  expect(saves.saves[0].request.bpic19_pipeline?.actions[0].definition_id).toBe("definition-A");
  if (change === "dirty") session.valid("bpic19_profile", false);
  else session.reviewed({ ...action, definition_id: "definition-B" });
  const answer = saveAnswer(saves.saves[0].request, firstRevisionId, true);
  answer.revision.content.bpic19_pipeline = saves.saves[0].request.bpic19_pipeline;
  saves.saves[0].reply({ ok: true, answer }); await tick();
  expect(investigation.getState().saved).toBeNull();
  expect(saving.getState().save.phase).toBe("idle");
  session.basis(workspaceId, { ...identity, preparation_id: "preparation.v1:sha256:" + "f".repeat(64) });
  expect(saving.draft(investigation.getState()).ready).toBe(true);
  saving.stop(); investigation.stop();
});

it.each(["current", "changed"] as const)("exposes saved native view labels only for the verified %s revision", async change => {
  const imports = scriptedImportClient(), selection = scriptedSelectionClient(), saves = scriptedSavingClient();
  const investigation = new ImportedInvestigationCoordinator(imports.client, selection.client, scriptedViewClient().client);
  const session = new Bpic19Session();
  const saving = new SavingCoordinator(saves.client, investigation, undefined, undefined, session);
  investigation.open({ workspaceId, preparationId });
  imports.populations[0].reply({ ok: true, answer: populationAnswer(imports.populations[0].request) }); await tick();
  selection.selections[0].reply({ ok: true, answer: selectionAnswer(selection.selections[0].request, everyIncident) }); await tick();
  selection.graphs[0].reply({ ok: true, answer: graphAnswer(selection.graphs[0].request, everyIncident.kept.case_ids) }); await tick();
  const selected = shownSelection(investigation.getState().selection)!.answer.identity;
  session.basis(workspaceId, selected);
  const action = { operation: "bpic19_score" as const, identity: selected, query: { run_id: "literal-run" }, definition_id: "literal-definition" };
  session.reviewed(action);
  saving.save("Frozen native views", "", "incidents");
  const answer = saveAnswer(saves.saves[0].request, firstRevisionId, true);
  answer.revision.content.bpic19_pipeline = saves.saves[0].request.bpic19_pipeline;
  answer.bpic19_outputs = { schema_version: 1, outputs: [{ operation: "bpic19_score", definition_id: action.definition_id,
    sha256: "a".repeat(64), output: { run_id: "literal-run", report: { profile_id: "bpic19.paper.2026-10-12.v1", settings: { view: "Balanced", mode: "flat", gamma: 0, volume: "cases" } } } }] };
  if (change === "changed") session.valid("bpic19_score", false);
  saves.saves[0].reply({ ok: true, answer }); await tick();
  expect(saving.nativeRunLabels("another-revision")).toEqual({});
  expect(saving.nativeRunLabels(firstRevisionId)).toEqual(change === "current" ? { "literal-run": "WISE paper · Balanced · flat · gamma 0 · Scored item count" } : {});
  saving.stop(); investigation.stop();
});

it("distinguishes immutable count, reviewed exposure and legacy generic snapshots after save and reopen", async () => {
  const imports = scriptedImportClient(), selection = scriptedSelectionClient(), saves = scriptedSavingClient();
  const investigation = new ImportedInvestigationCoordinator(imports.client, selection.client, scriptedViewClient().client);
  const session = new Bpic19Session();
  const saving = new SavingCoordinator(saves.client, investigation, undefined, undefined, session);
  investigation.open({workspaceId, preparationId});
  imports.populations[0].reply({ok: true, answer: populationAnswer(imports.populations[0].request)}); await tick();
  selection.selections[0].reply({ok: true, answer: selectionAnswer(selection.selections[0].request, everyIncident)}); await tick();
  selection.graphs[0].reply({ok: true, answer: graphAnswer(selection.graphs[0].request, everyIncident.kept.case_ids)}); await tick();
  const state = investigation.getState();
  if (state.population.phase !== "ready") throw new Error("The reviewed source must be ready");
  const selected = shownSelection(state.selection)!.answer.identity;
  const actions = ["count", "reviewed-exposure", "generic-exposure"].map(name => ({operation: "bpic19_score" as const,
    identity: selected, selection_prefix_length: 0, query: {run_id: `literal-${name}`}, definition_id: `definition-${name}`}));
  expect(session.restore(workspaceId, selected, [], actions, state.population.answer.identity)).toBe(true);
  saving.save("Count and exposure snapshots", "Same view, different frozen multipliers", "incidents");
  const requestBefore = structuredClone(saves.saves[0].request);
  const answer = saveAnswer(saves.saves[0].request, firstRevisionId, true);
  answer.revision.content.bpic19_pipeline = structuredClone(saves.saves[0].request.bpic19_pipeline);
  const reviewedCalibration = {policy: "creation_unique_value", unit_provenance: "explicit_raw_measures_definition.v1", source_unit: "EUR"};
  const outputs: Bpic19PipelineOutput[] = actions.map((action, index) => ({operation: action.operation,
    definition_id: action.definition_id, sha256: String(index + 1).repeat(64), output: {run_id: action.query.run_id,
      definition: {settings: {exposure_policy: index === 2 ? "max_absolute_p95" : "creation_unique_value"}},
      report: {profile_id: "bpic19.paper.2026-10-12.v1", settings: {view: "Balanced", mode: "flat", gamma: 0, volume: index === 0 ? "cases" : "exposure"},
        exposure_calibration: index === 0 ? null : index === 1 ? reviewedCalibration :
          {policy: "max_absolute_p95", unit_provenance: "unconfirmed_generic_source_value_units", source_unit: "EUR"}}}}));
  answer.bpic19_outputs = {schema_version: 1, outputs: [outputs[0], ...outputs.slice(1)]};
  const frozenAnswer = structuredClone(answer);
  saves.saves[0].reply({ok: true, answer}); await tick();
  const expected = {
    "literal-count": "WISE paper · Balanced · flat · gamma 0 · Scored item count",
    "literal-reviewed-exposure": "WISE paper · Balanced · flat · gamma 0 · Exposure · unique finite creation value · reviewed source unit EUR",
    "literal-generic-exposure": "WISE paper · Balanced · flat · gamma 0 · Exposure · maximum absolute value · frozen P95 · generic source units",
  };
  expect(saving.nativeRunLabels(firstRevisionId)).toEqual(expected);
  reviewedCalibration.source_unit = "USD";
  expect(saving.nativeRunLabels(firstRevisionId)).toEqual(expected);
  expect(saves.saves[0].request).toEqual(requestBefore);
  expect(imports.evidence).toHaveLength(0);
  expect(imports.populations).toHaveLength(1);
  expect(selection.selections).toHaveLength(1);
  const reopening = saving.reopen({...savedSummary, latest_revision_id: firstRevisionId, selected_case_count: 2, selected_record_count: 3}, workspaceId);
  const reply = reopenAnswer(saves.reopens[0].request);
  reply.revision = frozenAnswer.revision;
  reply.bpic19_outputs = frozenAnswer.bpic19_outputs;
  reply.restored_selection = {...reply.restored_selection, identity: selected, kept: {case_ids: ["A-1", "B-2"], case_count: 2, record_count: 3},
    removed: {case_ids: [], case_count: 0, record_count: 0}, predicate_results: []};
  saves.reopens[0].reply({ok: true, answer: reply}); await tick();
  expect(await reopening).toBe(true);
  expect(saving.nativeRunLabels(firstRevisionId)).toEqual(expected);
  expect(saves.saves).toHaveLength(1);
  expect(saves.reopens).toHaveLength(1);
  expect(saves.saves[0].request).toEqual(requestBefore);
  saving.stop(); investigation.stop();
});
