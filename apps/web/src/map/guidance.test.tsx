import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { ImportedInvestigation } from "../imported/ImportedInvestigation";
import { populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { bothSteps, closed, contains, containingOpened, everyIncident, type Figures, follows, graphAnswer, opened, scriptedSelectionClient, selectionAnswer, suppliedGraph } from "../test/selections";

// #95: one line of guidance at a time: the ways to a first step, then, after it, how to go back or on.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

async function start() {
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const coordinator = new ImportedInvestigationCoordinator(imports.client, selecting.client);
  render(<ImportedInvestigation coordinator={coordinator} onShowData={() => undefined} initialView="incidents" />);
  act(() => coordinator.open({ workspaceId, preparationId }));
  await deliver(() => imports.populations[0].reply({ ok: true, answer: populationAnswer(imports.populations[0].request) }));
  const app = { selecting, coordinator, user: userEvent.setup() };
  await answer(app, everyIncident);
  return app;
}

async function answer(app: { selecting: ReturnType<typeof scriptedSelectionClient> }, figures: Figures) {
  const selection = app.selecting.selections.at(-1)!;
  await deliver(() => selection.reply({ ok: true, answer: selectionAnswer(selection.request, figures) }));
  const graph = app.selecting.graphs.find((call) => call.request.query_revision === selection.request.query_revision)!;
  await deliver(() => graph.reply({ ok: true, answer: { ...graphAnswer(graph.request, figures.kept.case_ids), graph: suppliedGraph(figures.kept.case_ids) } }));
}

const lines = () => Array.from(document.querySelectorAll(".guide-line"), (line) => line.textContent);

describe("the line of guidance", () => {
  it("names the ways to a first step in the empty state, each leading to its control", async () => {
    const app = await start();
    expect(lines()).toEqual(["No step yet: every incident of the parent is kept. Take a first step: select an activity or a path on the map, drag over a period of starts, or add a step."]);
    const line = document.querySelector<HTMLElement>(".guide-line")!;
    await app.user.click(within(line).getByRole("button", { name: "add a step" }));
    expect(screen.getByRole("group", { name: "Add a step" })).toBeTruthy();
    await app.user.keyboard("{Escape}");
    await app.user.click(within(line).getByRole("button", { name: "select an activity or a path on the map" }));
    expect(within(screen.getByRole("group", { name: "View" })).getByRole("button", { name: "Map" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("after the first step says how to undo or add another, then gives way for good; never two lines", async () => {
    const app = await start();
    act(() => app.coordinator.addStep(contains(opened)));
    await answer(app, containingOpened);
    expect(lines()).toEqual(["One step taken: Undo takes it back, or add another step."]);
    act(() => app.coordinator.addStep(follows(opened, closed)));
    await answer(app, bothSteps);
    expect(lines()).toEqual([]);
    // Back to one step: the line has given way and does not come back.
    act(() => app.coordinator.undo());
    await answer(app, containingOpened);
    expect(lines()).toEqual([]);
  });
});
