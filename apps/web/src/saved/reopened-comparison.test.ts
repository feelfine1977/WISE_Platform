import { describe, expect, it } from "vitest";
import type { SavedComparison } from "../generated/saving";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { populationAnswer, scriptedImportClient, workspaceId } from "../test/imports";
import { reopenAnswer, savedSummary, scriptedSavingClient } from "../test/saving";
import { scriptedSelectionClient } from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { type ComparisonSource, SavingCoordinator } from "./coordinator";

describe("the comparison of a reopened investigation", () => {
  it("is handed to the comparison view with the reading it was saved on", async () => {
    const restored: { workspaceId: string; identity: unknown; saved: SavedComparison | null }[] = [];
    const comparisons: ComparisonSource = {
      savedComparisonFor: () => null,
      restore: (workspace, identity, saved) => restored.push({ workspaceId: workspace, identity, saved }),
    };
    const saving = scriptedSavingClient();
    const imports = scriptedImportClient();
    const investigation = new ImportedInvestigationCoordinator(imports.client, scriptedSelectionClient().client, scriptedViewClient().client);
    const coordinator = new SavingCoordinator(saving.client, investigation, comparisons);

    const reopened = coordinator.reopen(savedSummary, workspaceId);
    const { request, reply } = saving.reopens[0];
    const answer = reopenAnswer(request);
    reply({ ok: true, answer });

    expect(await reopened).toBe(true);
    // Nothing is handed over while the reopened question is still being opened.
    expect(restored).toEqual([]);
    const population = imports.populations[0];
    population.reply({ ok: true, answer: populationAnswer(population.request) });
    await Promise.resolve();
    await Promise.resolve();
    expect(restored).toEqual([
      { workspaceId, identity: answer.revision.content.base_identity, saved: answer.revision.content.comparison },
    ]);
  });
});
