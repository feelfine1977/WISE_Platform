import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { everyIncident, graphAnswer, scriptedSelectionClient, selectionAnswer } from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { ImportedInvestigation } from "./ImportedInvestigation";
import { ImportedInvestigationCoordinator } from "./coordinator";

vi.mock("../map/MapView", () => ({ MapView: () => <p>Map of the kept incidents</p> }));
// The groups panel hands a chosen group to the investigation; here a button stands for choosing one.
vi.mock("../groups/GroupsPanel", () => ({
  GroupsPanel: ({ onChoose }: { onChoose: (group: { id: string; label: string; caseIds: readonly string[] }) => void }) => (
    <button type="button" onClick={() => onChoose({ id: "reference:Unknown", label: "Unknown", caseIds: ["A-1"] })}>Choose the group Unknown</button>
  ),
}));

async function deliver(action: () => void) {
  await act(async () => { action(); });
}

it("makes a group a side of Compare without changing the selection, apart from Keep and Remove (#51)", async () => {
  const imports = scriptedImportClient(), selecting = scriptedSelectionClient(), views = scriptedViewClient();
  const coordinator = new ImportedInvestigationCoordinator(imports.client, selecting.client, views.client);
  const onCompareGroup = vi.fn(), onShowComparison = vi.fn();
  const user = userEvent.setup();
  render(<ImportedInvestigation coordinator={coordinator} onShowData={() => undefined} onCompareGroup={onCompareGroup} onShowComparison={onShowComparison} initialView="incidents" />);
  act(() => coordinator.open({ workspaceId, preparationId }));
  await deliver(() => imports.populations[0].reply({ ok: true, answer: populationAnswer(imports.populations[0].request) }));
  await deliver(() => selecting.selections[0].reply({ ok: true, answer: selectionAnswer(selecting.selections[0].request, everyIncident) }));
  await deliver(() => selecting.graphs[0].reply({ ok: true, answer: graphAnswer(selecting.graphs[0].request, ["A-1", "B-2"]) }));
  const asked = selecting.selections.length;
  const before = structuredClone(coordinator.getState().selection);

  await user.click(screen.getByRole("button", { name: "Groups" }));
  await user.click(screen.getByRole("button", { name: "Choose the group Unknown" }));
  // Four distinct actions on the chosen group: inspect is already done by listing it; Keep, Remove and two sides of Compare.
  for (const name of ["Keep these incidents", "Remove these incidents", "Compare as A", "Compare as B", "Show every incident"]) expect(screen.getByRole("button", { name })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Compare as A" }));
  expect(onCompareGroup).toHaveBeenCalledWith("target", "Unknown", ["A-1"]);
  expect(screen.getByText(/“Unknown” is side A in Compare, as its 1 incident; the selection is unchanged\./)).toBeTruthy();
  expect(selecting.selections.length).toBe(asked);
  expect(coordinator.getState().selection).toEqual(before);
  await user.click(screen.getByRole("button", { name: "Show the comparison" }));
  expect(onShowComparison).toHaveBeenCalledOnce();
});
