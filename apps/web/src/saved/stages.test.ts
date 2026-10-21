import { expect, it } from "vitest";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { noStages, originOf, toPresentation, withActivity, withProposed, withStage } from "../stages/definitions";
import { type StageMemory, StageStore } from "../stages/store";
import { populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { everyIncident, graphAnswer, scriptedSelectionClient, selectionAnswer } from "../test/selections";
import { reopenAnswer, saveAnswer, savedContent, savedSummary, scriptedSavingClient, firstRevisionId } from "../test/saving";
import { scriptedViewClient } from "../test/views";
import { savingContract } from "./client";
import { SavingCoordinator } from "./coordinator";

const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const memory: StageMemory = { recall: () => noStages, remember: () => true };
const reading = { workspaceId, preparationId: savedContent.base_identity.preparation_id };

async function shown() {
  const imports = scriptedImportClient(), selecting = scriptedSelectionClient(), saved = scriptedSavingClient();
  const investigation = new ImportedInvestigationCoordinator(imports.client, selecting.client, scriptedViewClient().client);
  const stages = new StageStore(memory);
  const saving = new SavingCoordinator(saved.client, investigation, undefined, undefined, undefined, undefined, stages);
  investigation.open({ workspaceId, preparationId });
  imports.populations[0].reply({ ok: true, answer: populationAnswer(imports.populations[0].request) }); await tick();
  selecting.selections[0].reply({ ok: true, answer: selectionAnswer(selecting.selections[0].request, everyIncident) }); await tick();
  selecting.graphs[0].reply({ ok: true, answer: graphAnswer(selecting.graphs[0].request, ["A-1", "B-2"]) }); await tick();
  return { investigation, saving, saved, stages };
}

it("saves the stages of the reading with the investigation, bound to its preparation, with their origins and the phase column", async () => {
  const { saving, saved, stages } = await shown();
  const defined = withActivity(withProposed(withStage(noStages, "Closure"), "Eröffnet", 4, "Intake"), "Geschlossen", "stage:1");
  stages.change({ workspaceId, preparationId }, () => ({ ...defined, phaseColumn: 4 }));
  saving.save("With stages", "", "map");
  const request = saved.saves[0].request;
  expect(savingContract.saveRequest(request)).toBe(true);
  expect(request.presentation_state?.stages).toEqual(toPresentation({ ...defined, phaseColumn: 4 }, preparationId));
  expect(request.presentation_state?.stages?.preparation_id).toBe(request.base_identity.preparation_id);
  saved.saves[0].reply({ ok: true, answer: saveAnswer(request, firstRevisionId, true) }); await tick();
});

it("saves no stages for a reading without one", async () => {
  const { saving, saved } = await shown();
  saving.save("Without stages", "", "incidents");
  expect("stages" in (saved.saves[0].request.presentation_state ?? {})).toBe(false);
});

it("shows the stages saved with a reopened investigation for its reading, and says so", async () => {
  const { saving, saved, stages } = await shown();
  const own = withProposed(noStages, "Eröffnet", 4, "Intake");
  const requested = saving.reopen(savedSummary, workspaceId);
  const call = saved.reopens[0];
  const answer = reopenAnswer(call.request);
  answer.recovery = { presentation_state: { ...answer.recovery.presentation_state!, stages: toPresentation(own, reading.preparationId) }, warnings: [] };
  expect(savingContract.reopenAnswer(answer)).toBe(true);
  call.reply({ ok: true, answer }); await requested; await tick();
  const state = stages.stateOf(reading);
  expect(state.definitions.stages.map((stage) => stage.name)).toEqual(["Intake"]);
  expect(originOf(state.definitions, "Eröffnet")).toEqual({ kind: "proposed", column: 4, value: "Intake" });
  expect(state.notice).toEqual({ kind: "restored", investigation: savedContent.name });
});

it("applies no stages the local service left out, or that name another preparation, and says why", async () => {
  const { saving, saved, stages } = await shown();
  const before = withStage(noStages, "Shown before");
  stages.change(reading, () => before);
  const requested = saving.reopen(savedSummary, workspaceId);
  const call = saved.reopens[0];
  const answer = reopenAnswer(call.request);
  const message = "The stages saved with this investigation were not applied: the stages were defined for another reading of the source. The cases and every count are as saved.";
  answer.recovery = { ...answer.recovery, warnings: [{ code: "stages_not_applied", message }] };
  call.reply({ ok: true, answer }); await requested; await tick();
  expect(stages.stateOf(reading).definitions).toBe(before);
  expect(stages.stateOf(reading).notice).toEqual({ kind: "not_applied", investigation: savedContent.name, message });

  // Bound to another preparation, the stages are not applied even where the reply carries them.
  const again = saving.reopen(savedSummary, workspaceId);
  const second = saved.reopens[1];
  const other = reopenAnswer(second.request);
  other.recovery = { presentation_state: { ...other.recovery.presentation_state!, stages: toPresentation(withStage(noStages, "Elsewhere"), `preparation.v1:sha256:${"9".repeat(64)}`) }, warnings: [] };
  second.reply({ ok: true, answer: other }); await again; await tick();
  expect(stages.stateOf(reading).definitions).toBe(before);
  expect(stages.stateOf(reading).notice?.kind).toBe("not_applied");
});
