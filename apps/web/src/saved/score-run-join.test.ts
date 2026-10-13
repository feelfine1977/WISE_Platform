import { describe, expect, it } from "vitest";
import type { ScoreRunReference } from "../generated/saving";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { reopenAnswer, savedSummary, scriptedSavingClient } from "../test/saving";
import { everyIncident, graphAnswer, scriptedSelectionClient, selectionAnswer } from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { savingContract } from "./client";
import { type ScoreSource, SavingCoordinator } from "./coordinator";

const reference: ScoreRunReference = {
  score_run_id: `score-run.v1:sha256:${"1".repeat(64)}`,
  scored_population_id: `population.v1:sha256:${"f".repeat(64)}`,
  calibration_id: `calibration.v1:sha256:${"2".repeat(64)}`,
};

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function fixture(shown: ScoreRunReference | null) {
  const restored: (ScoreRunReference | null)[] = [];
  const scores: ScoreSource = { savedReference: () => shown, restore: (given) => restored.push(given) };
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const saves = scriptedSavingClient();
  const investigation = new ImportedInvestigationCoordinator(imports.client, selecting.client, scriptedViewClient().client);
  const saving = new SavingCoordinator(saves.client, investigation, undefined, scores);
  return { imports, selecting, saves, investigation, saving, restored };
}

async function openIncidents(app: ReturnType<typeof fixture>): Promise<void> {
  app.investigation.open({ workspaceId, preparationId });
  const population = app.imports.populations[0];
  population.reply({ ok: true, answer: populationAnswer(population.request) });
  await settle();
  const selection = app.selecting.selections[0];
  selection.reply({ ok: true, answer: selectionAnswer(selection.request, everyIncident) });
  await settle();
  const graph = app.selecting.graphs[0];
  graph.reply({ ok: true, answer: graphAnswer(graph.request, everyIncident.kept.case_ids) });
  await settle();
}

describe("the score run of a saved investigation", () => {
  it("is referred to when the investigation is saved while a run is shown", async () => {
    const app = fixture(reference);
    await openIncidents(app);

    app.saving.save("With its score", "", "incidents");

    const { request } = app.saves.saves[0];
    expect(savingContract.saveRequest(request)).toBe(true);
    expect(request.score_run_ref).toEqual(reference);
  });

  it("is left out when no run is shown and the investigation refers to none", async () => {
    const app = fixture(null);
    await openIncidents(app);

    app.saving.save("Without a score", "", "incidents");

    expect("score_run_ref" in app.saves.saves[0].request).toBe(false);
  });

  it("is handed back to the expectation view when the investigation is reopened", async () => {
    const app = fixture(null);
    const reopened = app.saving.reopen(savedSummary, workspaceId);
    const { request, reply } = app.saves.reopens[0];
    const answer = reopenAnswer(request);
    reply({ ok: true, answer });

    expect(await reopened).toBe(true);
    // Nothing is handed back while the reopened question is still being opened.
    expect(app.restored).toEqual([]);
    const population = app.imports.populations[0];
    population.reply({ ok: true, answer: populationAnswer(population.request) });
    await settle();
    expect(app.restored).toEqual([answer.revision.content.score_run_ref ?? null]);
  });
});
