import { expect, it } from "vitest";
import { Bpic19Session } from "../bpic19/session";
import { ImportedInvestigationCoordinator, shownSelection } from "../imported/coordinator";
import { SavingCoordinator } from "./coordinator";
import { identity, populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { everyIncident, graphAnswer, scriptedSelectionClient, selectionAnswer } from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { firstRevisionId, saveAnswer, scriptedSavingClient } from "../test/saving";

const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

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
    sha256: "a".repeat(64), output: { run_id: "literal-run", report: { profile_id: "bpic19.paper.2026-10-12.v1", settings: { view: "Balanced", mode: "flat", gamma: 0 } } } }] };
  if (change === "changed") session.valid("bpic19_score", false);
  saves.saves[0].reply({ ok: true, answer }); await tick();
  expect(saving.nativeRunLabels("another-revision")).toEqual({});
  expect(saving.nativeRunLabels(firstRevisionId)).toEqual(change === "current" ? { "literal-run": "WISE paper · Balanced · flat · gamma 0" } : {});
  saving.stop(); investigation.stop();
});
