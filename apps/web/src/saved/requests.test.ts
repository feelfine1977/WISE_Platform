import { expect, it } from "vitest";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { RequestsStore } from "../requests/definitions";
import { noStages } from "../stages/definitions";
import { type StageMemory, StageStore } from "../stages/store";
import { populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { everyIncident, graphAnswer, scriptedSelectionClient, selectionAnswer } from "../test/selections";
import { reopenAnswer, savedContent, savedSummary, scriptedSavingClient } from "../test/saving";
import { scriptedViewClient } from "../test/views";
import { savingContract } from "./client";
import { SavingCoordinator } from "./coordinator";

const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const memory: StageMemory = { recall: () => noStages, remember: () => true };
const storage = () => { const kept = new Map<string, string>(); return { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) }; };
const draft = { requests: ["Eröffnet"], answers: ["Geschlossen"], turn: null, gapHours: 48, reviewed: false };

async function shown() {
  const imports = scriptedImportClient(), selecting = scriptedSelectionClient(), saved = scriptedSavingClient();
  const investigation = new ImportedInvestigationCoordinator(imports.client, selecting.client, scriptedViewClient().client);
  const requests = new RequestsStore(storage());
  const saving = new SavingCoordinator(saved.client, investigation, undefined, undefined, undefined, undefined, new StageStore(memory), requests);
  investigation.open({ workspaceId, preparationId });
  imports.populations[0].reply({ ok: true, answer: populationAnswer(imports.populations[0].request) }); await tick();
  selecting.selections[0].reply({ ok: true, answer: selectionAnswer(selecting.selections[0].request, everyIncident) }); await tick();
  selecting.graphs[0].reply({ ok: true, answer: graphAnswer(selecting.graphs[0].request, ["A-1", "B-2"]) }); await tick();
  return { saving, saved, requests };
}

it("saves a reviewed definition of requests with the investigation, bound to its reading, and never a draft", async () => {
  const { saving, saved, requests } = await shown();
  requests.change({ workspaceId, preparationId }, () => draft);
  saving.save("Draft only", "", "incidents");
  expect("requests" in (saved.saves[0].request.presentation_state ?? {})).toBe(false);
  requests.change({ workspaceId, preparationId }, (current) => ({ ...current, reviewed: true }));
  saving.save("Reviewed", "", "incidents");
  const request = saved.saves[1].request;
  expect(savingContract.saveRequest(request)).toBe(true);
  expect(request.presentation_state?.requests).toEqual({ preparation_id: preparationId, request_activities: ["Eröffnet"], answer_activities: ["Geschlossen"], turn: null, gap_hours: 48, reviewed: true });
});

it("restores a saved definition for its reading, and says why one was not applied", async () => {
  const { saving, saved, requests } = await shown();
  const reading = { workspaceId, preparationId: savedContent.base_identity.preparation_id };
  const first = saving.reopen(savedSummary, workspaceId);
  const answer = reopenAnswer(saved.reopens[0].request);
  answer.recovery = { presentation_state: { ...answer.recovery.presentation_state!, requests: { preparation_id: reading.preparationId, request_activities: ["Eröffnet"],
    answer_activities: ["Geschlossen"], turn: null, gap_hours: null, reviewed: true } }, warnings: [] };
  expect(savingContract.reopenAnswer(answer)).toBe(true);
  saved.reopens[0].reply({ ok: true, answer }); await first; await tick();
  expect(requests.stateOf(reading)).toEqual({ draft: { requests: ["Eröffnet"], answers: ["Geschlossen"], turn: null, gapHours: null, reviewed: true },
    notice: { kind: "restored", investigation: savedContent.name } });

  const second = saving.reopen(savedSummary, workspaceId);
  const left = reopenAnswer(saved.reopens[1].request);
  left.recovery = { ...left.recovery, warnings: [{ code: "requests_not_applied", message: "The definition of requests saved with this investigation was not applied." }] };
  saved.reopens[1].reply({ ok: true, answer: left }); await second; await tick();
  expect(requests.stateOf(reading).notice?.kind).toBe("not_applied");
  expect(requests.stateOf(reading).draft.requests).toEqual(["Eröffnet"]);
});
