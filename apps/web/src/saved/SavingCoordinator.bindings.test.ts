import { afterEach, describe, expect, it } from "vitest";
import { importContract } from "../data/client";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { selectionContract } from "../map/client";
import type { ScoreRunReference } from "../generated/saving";
import {
  earlierPreparationId,
  populationAnswer,
  preparationId,
  scriptedImportClient,
  workspaceId,
} from "../test/imports";
import {
  baseIdentity,
  firstRevisionId,
  investigationId,
  reopenAnswer,
  saveAnswer,
  savedSummary,
  scriptedSavingClient,
  secondRevisionId,
} from "../test/saving";
import {
  containingOpened,
  everyIncident,
  graphAnswer,
  scriptedSelectionClient,
  selectionAnswer,
  type Figures,
} from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { savingContract } from "./client";
import { SavingCoordinator } from "./coordinator";

const active: { stop(): void }[] = [];
afterEach(() => {
  for (const coordinator of active.splice(0)) coordinator.stop();
});

function fixture() {
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const saves = scriptedSavingClient();
  const investigation = new ImportedInvestigationCoordinator(imports.client, selecting.client, scriptedViewClient().client);
  const saving = new SavingCoordinator(saves.client, investigation);
  active.push(investigation, saving);
  return { imports, selecting, saves, investigation, saving };
}

type Fixture = ReturnType<typeof fixture>;

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

/** Publish existing independently authored typed population, selection and graph fixtures. */
async function answerInvestigation(app: Fixture, index: number, figures: Figures = everyIncident) {
  const population = app.imports.populations[index];
  const populationReply = populationAnswer(population.request);
  expect(importContract.populationAnswer(populationReply)).toBe(true);
  population.reply({ ok: true, answer: populationReply });
  await settle();
  const selection = app.selecting.selections[index];
  const selectionReply = selectionAnswer(selection.request, figures);
  expect(selectionContract.selectionAnswer(selectionReply)).toBe(true);
  selection.reply({ ok: true, answer: selectionReply });
  await settle();
  const graph = app.selecting.graphs[index];
  const graphReply = graphAnswer(graph.request, figures.kept.case_ids);
  expect(selectionContract.processGraphAnswer(graphReply)).toBe(true);
  graph.reply({ ok: true, answer: graphReply });
  await settle();
  expect(app.investigation.getState().population.phase).toBe("ready");
  expect(app.investigation.getState().selection.phase).toBe("ready");
}

describe("saved bindings belong to the question they were published for", () => {
  it("does not attach a late save to a different preparation that has already answered", async () => {
    const app = fixture();
    app.investigation.open({ workspaceId, preparationId });
    await answerInvestigation(app, 0);
    app.saving.save("First question", "Before changing preparation.", "incidents");
    const earlierSave = app.saves.saves[0];
    expect(savingContract.saveRequest(earlierSave.request)).toBe(true);
    expect(earlierSave.request.base_identity.preparation_id).toBe(preparationId);

    app.investigation.open({ workspaceId, preparationId: earlierPreparationId });
    await answerInvestigation(app, 1);
    const current = app.investigation.getState();
    if (current.population.phase !== "ready" || current.selection.phase !== "ready") throw new Error("The second question must be answered.");
    expect(current.population.answer.identity.preparation_id).toBe(earlierPreparationId);
    expect(current.selection.shown.answer.identity.preparation_id).toBe(earlierPreparationId);
    expect(current.saved).toBeNull();
    const reply = saveAnswer(earlierSave.request, firstRevisionId, true);
    expect(savingContract.saveAnswer(reply)).toBe(true);

    // Cancellation does not guarantee that an already completed service reply will be dropped.
    earlierSave.reply({ ok: true, answer: reply });
    await settle();
    const after = app.investigation.getState();
    expect(after.population).toEqual(current.population);
    expect(after.selection).toEqual(current.selection);
    expect(after.saved).toBeNull();
  });

  it("carries a reopened immutable score reference when only the note is revised", async () => {
    const app = fixture();
    const reference: ScoreRunReference = {
      score_run_id: `score-run.v1:sha256:${"2".repeat(64)}`,
      scored_population_id: baseIdentity.population_id,
      calibration_id: `calibration.v1:sha256:${"4".repeat(64)}`,
    };
    const reopening = app.saving.reopen({ ...savedSummary, has_score_run: true }, workspaceId);
    const call = app.saves.reopens[0];
    expect(savingContract.reopenRequest(call.request)).toBe(true);
    const reply = reopenAnswer(call.request, "incidents");
    reply.revision.content = { ...reply.revision.content, score_run_ref: reference };
    expect(savingContract.reopenAnswer(reply)).toBe(true);
    call.reply({ ok: true, answer: reply });
    expect(await reopening).toBe(true);
    await answerInvestigation(app, 0, containingOpened);
    expect(app.investigation.getState().saved?.content.score_run_ref).toEqual(reference);

    app.saving.save(reply.revision.content.name, "A revised note, keeping the original result.", "incidents");
    const revision = app.saves.saves[0].request;
    expect(savingContract.saveRequest(revision)).toBe(true);
    expect(revision.investigation_id).toBe(investigationId);
    expect(revision.expected_revision_id).toBe(secondRevisionId);
    expect(revision.base_identity).toEqual(reply.revision.content.base_identity);
    expect(revision.selection_identity).toEqual(reply.revision.content.selection_identity);
    expect(revision.selection_recipe).toEqual(reply.revision.content.selection_recipe);
    expect(revision.comparison).toEqual(reply.revision.content.comparison);
    expect(revision.notes).toBe("A revised note, keeping the original result.");
    expect(revision.score_run_ref).toEqual(reference);
  });
});
