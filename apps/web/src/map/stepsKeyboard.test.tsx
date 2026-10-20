import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { ImportedInvestigation } from "../imported/ImportedInvestigation";
import { populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { bothSteps, closed, contains, containingOpened, everyIncident, type Figures, follows, graphAnswer, opened, scriptedSelectionClient, selectionAnswer, suppliedGraph } from "../test/selections";

// #96: the bar of steps and its trail by keyboard, the focus after each action, and a polite word on each change.
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

const bar = () => screen.getByRole("group", { name: "Steps" });
const said = () => document.querySelector(".steps-announcement")?.textContent;
const focusedName = () => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent;

describe("the bar of steps by keyboard", () => {
  it("is one tab stop whose arrow keys move between the actions that can be used, and Escape leaves it for the views", async () => {
    const app = await start();
    act(() => app.coordinator.addStep(contains(opened)));
    await answer(app, containingOpened);
    const buttons = within(bar()).getAllByRole("button");
    // Undo and Clear all can be used: one of them is the tab stop.
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1]);
    buttons[0].focus();
    await app.user.keyboard("{ArrowRight}");
    expect(focusedName()).toBe("Clear all");
    await app.user.keyboard("{Home}");
    expect(focusedName()).toBe("Undo");
    await app.user.keyboard("{Escape}");
    expect(document.activeElement?.textContent).toBe("Incidents");
  });

  it("keeps the focus on an action that can still be used after Undo and Clear all, and says what changed with the incidents kept", async () => {
    const app = await start();
    act(() => app.coordinator.addStep(contains(opened)));
    await answer(app, containingOpened);
    expect(said()).toBe("Step added: With “Eröffnet”. 1 of 2 incidents kept.");
    await app.user.click(within(bar()).getByRole("button", { name: "Undo" }));
    await answer(app, everyIncident);
    // Undo cannot be used any more: the focus goes to Redo, never to the page.
    expect(focusedName()).toBe("Redo");
    expect(said()).toBe("Undone: With “Eröffnet”. 2 of 2 incidents kept.");
    await app.user.click(within(bar()).getByRole("button", { name: "Redo" }));
    await answer(app, containingOpened);
    expect(said()).toBe("Redone: With “Eröffnet”. 1 of 2 incidents kept.");
    await app.user.click(within(bar()).getByRole("button", { name: "Clear all" }));
    await answer(app, everyIncident);
    expect(focusedName()).toBe("Undo");
    expect(said()).toBe("Every step removed. 2 of 2 incidents kept.");
  });

  it("takes the focus to the new chip after a new step, where it would otherwise be lost, and moves along the trail by the arrow keys", async () => {
    const app = await start();
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => app.coordinator.addStep(contains(opened)));
    await answer(app, containingOpened);
    act(() => app.coordinator.addStep(follows(opened, closed)));
    await answer(app, bothSteps);
    const chips = Array.from(document.querySelectorAll<HTMLElement>('ul[aria-label="Steps of the selection"] > li > details > summary'));
    expect(document.activeElement).toBe(chips[1]);
    // One tab stop in the trail: the chip in focus.
    const parentButton = screen.getByRole("button", { name: "Every incident of the parent · 2" });
    expect([parentButton.tabIndex, chips[0].tabIndex, chips[1].tabIndex]).toEqual([-1, -1, 0]);
    await app.user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(chips[0]);
    await app.user.keyboard("{Home}");
    expect(document.activeElement).toBe(parentButton);
    await app.user.keyboard("{End}");
    expect(document.activeElement).toBe(chips[1]);
    await app.user.keyboard("{Escape}");
    expect(document.activeElement?.textContent).toBe("Incidents");
  });
});
