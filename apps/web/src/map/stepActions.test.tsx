import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { ImportedInvestigation } from "../imported/ImportedInvestigation";
import { populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { SelectionSteps } from "./SelectionSteps";
import { contains, containingOpened, everyIncident, type Figures, graphAnswer, opened, scriptedSelectionClient, selectionAnswer, suppliedGraph } from "../test/selections";

// #92: Undo, Redo and Clear all as icon buttons in fixed slots, each named, with a tooltip and, when unusable, the reason.
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
  render(<ImportedInvestigation coordinator={coordinator} onShowData={() => undefined} />);
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

/** The three slots in their order: each one's name, whether it can be used, its tooltip and its description. */
function slots() {
  const group = screen.getByRole("group", { name: "Steps" });
  return within(group).getAllByRole("button").map((button) => {
    const description = (button.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean).map((id) => document.getElementById(id)?.textContent).join(" | ");
    return [button.getAttribute("aria-label"), (button as HTMLButtonElement).disabled, button.getAttribute("title"), description, button.className, button.textContent];
  });
}

describe("the actions of the bar of steps", () => {
  it("stands as three icon buttons in fixed slots, each disabled in its place with the reason while it cannot be used", async () => {
    await start();
    expect(slots()).toEqual([
      ["Undo", true, "Undo\nNothing to undo: the steps have not been changed.", "Nothing to undo: the steps have not been changed.", "icon-button", "Nothing to undo: the steps have not been changed."],
      ["Redo", true, "Redo\nNothing to redo: no change of the steps has been undone.", "Nothing to redo: no change of the steps has been undone.", "icon-button", "Nothing to redo: no change of the steps has been undone."],
      ["Clear all", true, "Clear all\nNo step to clear: every incident of the parent is kept.", "No step to clear: every incident of the parent is kept.", "icon-button", "No step to clear: every incident of the parent is kept."],
    ]);
    // An icon in place of the words: the buttons draw no word of their own.
    for (const button of within(screen.getByRole("group", { name: "Steps" })).getAllByRole("button")) expect(button.querySelector("svg.icon")).not.toBeNull();
  });

  it("enables each action in its own slot as it becomes usable, and says what it does", async () => {
    const app = await start();
    act(() => app.coordinator.addStep(contains(opened)));
    await answer(app, containingOpened);
    expect(slots().map(([name, disabled, title]) => [name, disabled, title])).toEqual([
      ["Undo", false, "Undo\nTakes back the last change of the steps."],
      ["Redo", true, "Redo\nNothing to redo: no change of the steps has been undone."],
      ["Clear all", false, "Clear all\nRemoves every step: every incident of the parent is kept again."],
    ]);
    await app.user.click(screen.getByRole("button", { name: "Undo" }));
    await answer(app, everyIncident);
    // Back before the only change: nothing more to undo, the change to redo, no step to clear.
    expect(slots().map(([name, disabled]) => [name, disabled])).toEqual([["Undo", true], ["Redo", false], ["Clear all", true]]);
    await app.user.click(screen.getByRole("button", { name: "Redo" }));
    await answer(app, containingOpened);
    expect(slots().map(([name, disabled]) => [name, disabled])).toEqual([["Undo", false], ["Redo", true], ["Clear all", false]]);
    await app.user.click(screen.getByRole("button", { name: "Clear all" }));
    await answer(app, everyIncident);
    expect(slots().map(([name, disabled]) => [name, disabled])).toEqual([["Undo", false], ["Redo", true], ["Clear all", true]]);
  });

  it("disables every action while the steps wait, describing why by the waiting text as well", () => {
    const request = { schema_version: 1 as const, message_type: "select_cases_request" as const, request_id: "r", query_revision: 1, workspace_id: workspaceId,
      identity: populationAnswer({ schema_version: 1, message_type: "open_population_request", request_id: "o", query_revision: 1, workspace_id: workspaceId, preparation_id: preparationId }).identity,
      parent_case_ids: null, predicates: [contains(opened)] };
    const selection = { phase: "ready" as const, revision: 1, history: { past: [[]], present: [contains(opened)], future: [] },
      shown: { revision: 1, steps: [contains(opened)], answer: selectionAnswer(request, containingOpened), graph: suppliedGraph(["A-1"]) } };
    render(
      <>
        <p id="waiting">The incidents are being opened.</p>
        <SelectionSteps selection={selection} onRemove={() => undefined} onClear={() => undefined} onUndo={() => undefined} onRedo={() => undefined}
          onRetry={() => undefined} onStay={() => undefined} waitingFor="waiting" />
      </>,
    );
    expect(slots().map(([name, disabled, , description]) => [name, disabled, description])).toEqual([
      ["Undo", true, "Takes back the last change of the steps. | The incidents are being opened."],
      ["Redo", true, "Nothing to redo: no change of the steps has been undone. | The incidents are being opened."],
      ["Clear all", true, "Removes every step: every incident of the parent is kept again. | The incidents are being opened."],
    ]);
  });
});
