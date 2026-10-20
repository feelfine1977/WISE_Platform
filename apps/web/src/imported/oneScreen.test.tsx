import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import webPackage from "../../package.json";
import { populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { closed, everyIncident, graphAnswer, opened, scriptedSelectionClient, selectionAnswer } from "../test/selections";
import { scriptedViewClient, variantIds } from "../test/views";
import type { VariantsAnswer, VariantsRequest } from "../views/messages";
import { ImportedInvestigation } from "./ImportedInvestigation";
import { ImportedInvestigationCoordinator } from "./coordinator";
import { KEYS } from "./KeysGuide";

vi.mock("../map/MapView", () => ({
  MapView: () => <p>Map of the kept incidents</p>,
}));
// The matrix opens the history of an incident from one of its passages; here a button stands for such a passage.
vi.mock("../matrix/TransitionMatrix", () => ({
  TransitionMatrix: ({ onOpenCase }: { onOpenCase: (caseId: string, rowIds: string[]) => void }) => (
    <button type="button" onClick={() => onOpenCase("A-1", [])}>
      A passage of A-1
    </button>
  ),
}));

async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

/** A-1 follows the two labelled activities; B-2 has an unknown order and is in no variant. */
function variantsOfTheTwoIncidents(request: VariantsRequest): VariantsAnswer {
  return {
    schema_version: 1,
    message_type: "variants_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: request.workspace_id,
    identity: request.identity,
    variants: {
      activity_projection_policy: "incident.activity.omit_missing_retain_raw_gaps.v1",
      case_count: 2,
      record_count: 3,
      omitted_activity_record_count: 0,
      sequence_evaluable_case_count: 1,
      variant_count: 1,
      variants: [{ id: variantIds[0], activities: [opened, closed], case_count: 1, share: 1, denominator: 1, case_ids: ["A-1"], record_count: 2, omitted_activity_record_count: 0 }],
      unevaluable: { case_ids: ["B-2"], case_count: 1, record_count: 1, omitted_activity_record_count: 0 },
    },
  };
}

async function openInvestigation({ answerSelection = true } = {}) {
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const views = scriptedViewClient();
  const coordinator = new ImportedInvestigationCoordinator(imports.client, selecting.client, views.client);
  const user = userEvent.setup();
  render(<ImportedInvestigation coordinator={coordinator} onShowData={() => undefined} />);
  act(() => coordinator.open({ workspaceId, preparationId }));
  await deliver(() => imports.populations[0].reply({ ok: true, answer: populationAnswer(imports.populations[0].request) }));
  if (answerSelection) {
    await deliver(() => selecting.selections[0].reply({ ok: true, answer: selectionAnswer(selecting.selections[0].request, everyIncident) }));
    await deliver(() => selecting.graphs[0].reply({ ok: true, answer: graphAnswer(selecting.graphs[0].request, ["A-1", "B-2"]) }));
    const variantRequest = views.variants.at(-1)!;
    await deliver(() => variantRequest.reply({ ok: true, answer: variantsOfTheTwoIncidents(variantRequest.request) }));
  }
  return { coordinator, user, imports, selecting, views };
}

const viewButton = (name: string) => within(screen.getByRole("group", { name: "View" })).getByRole("button", { name });

it("names Map, Incidents and Variants as views of the centre, and the variants there list a variant's incidents in the table", async () => {
  const { coordinator, user } = await openInvestigation();
  expect(within(screen.getByRole("group", { name: "View" })).getAllByRole("button").map((button) => button.textContent)).toEqual([
    "Map", "Incidents", "Variants", "Paths", "Matrix",
  ]);
  const before = structuredClone(coordinator.getState().selection);

  await user.click(viewButton("Variants"));
  expect(viewButton("Variants").getAttribute("aria-pressed")).toBe("true");
  const pane = screen.getByRole("region", { name: "Variants of the kept incidents" });
  // The side panel, opened beside it, does not show the same list twice.
  await user.click(screen.getByRole("button", { name: "Filters and views" }));
  await user.click(within(screen.getByRole("group", { name: "Side panel" })).getByRole("button", { name: "Variants" }));
  expect(screen.getByText("The variants are shown in the centre.")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "List the 1 incident of variant 1 in the table" })).toHaveLength(1);

  await user.click(within(pane).getByRole("button", { name: "List the 1 incident of variant 1 in the table" }));
  expect(viewButton("Incidents").getAttribute("aria-pressed")).toBe("true");
  expect(within(screen.getByRole("table", { name: "Kept incidents of variant 1" })).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["A-1"]);
  // Listing is a view: the selection is the one it was.
  expect(coordinator.getState().selection).toEqual(before);
  // Beside the table the side panel lists the variants again, so that another can be listed.
  expect(within(screen.getByRole("complementary")).getByRole("button", { name: "List the 1 incident of variant 1 in the table" })).toBeTruthy();
});

it("gives the keyboard back to what opened the history of an incident, outside the table as in it, and keeps the view and the selection", async () => {
  const { coordinator, user, imports } = await openInvestigation();
  const before = structuredClone(coordinator.getState().selection);
  await user.click(viewButton("Matrix"));
  const passage = screen.getByRole("button", { name: "A passage of A-1" });
  await user.click(passage);
  expect(imports.evidence.at(-1)!.request.case_id).toBe("A-1");
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Incident A-1" }));
  await user.keyboard("{Escape}");
  await act(async () => await new Promise((done) => requestAnimationFrame(() => done(undefined))));
  expect(screen.queryByRole("heading", { name: "Incident A-1" })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "A passage of A-1" }));
  expect(viewButton("Matrix").getAttribute("aria-pressed")).toBe("true");
  expect(coordinator.getState().selection).toEqual(before);

  // From the table, the keyboard goes back to the incident's row.
  await user.click(viewButton("Incidents"));
  await user.click(screen.getByRole("button", { name: "B-2" }));
  await user.keyboard("{Escape}");
  expect(document.activeElement?.textContent).toBe("B-2");
});

it("says that the matrix is shown once the incidents are selected, rather than showing nothing", async () => {
  const { user } = await openInvestigation({ answerSelection: false });
  await user.click(viewButton("Matrix"));
  expect(screen.getByText("Selecting the incidents for the matrix of their paths…")).toBeTruthy();
});

it("has a guide of the keys of every action, of this build, behind one button of the data row", async () => {
  const { user } = await openInvestigation();
  await user.click(screen.getByRole("button", { name: "Keys" }));
  const guide = screen.getByRole("group", { name: "Keys" });
  const rows = Array.from(guide.querySelectorAll(".keys-guide > div"), (row) => [row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent]);
  expect(rows).toEqual(KEYS.map(([part, keys]) => [part, keys]));
  expect(rows.map(([part]) => part)).toEqual([
    "Views", "Steps", "Trail of steps", "+ Add step", "Map", "Charts of starts and numbers", "Table of incidents", "History of an incident", "Panels like this one",
  ]);
  expect(guide.querySelector(".keys-version")?.textContent).toBe(
    `This guide is part of this build: web ${webPackage.version}, local service 0.1.0. It is shown from this computer, without a network.`,
  );
  await user.keyboard("{Escape}");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keys" }));
});

it("says in place of the map that the selection keeps no incident, with the way back (#71)", async () => {
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const views = scriptedViewClient();
  const coordinator = new ImportedInvestigationCoordinator(imports.client, selecting.client, views.client);
  render(<ImportedInvestigation coordinator={coordinator} onShowData={() => undefined} />);
  act(() => coordinator.open({ workspaceId, preparationId }));
  await deliver(() => imports.populations[0].reply({ ok: true, answer: populationAnswer(imports.populations[0].request) }));
  const none = { ...everyIncident, population: "0", kept: { ...everyIncident.kept, case_ids: [], case_count: 0, record_count: 0 }, removed: everyIncident.kept };
  await deliver(() => selecting.selections[0].reply({ ok: true, answer: selectionAnswer(selecting.selections[0].request, none) }));
  await deliver(() => selecting.graphs[0]?.reply({ ok: true, answer: graphAnswer(selecting.graphs[0].request, []) }));
  expect(document.querySelector(".map-empty")?.textContent).toMatch(/^The selection keeps no incident of the 2 incidents of its parent, so the map has nothing to draw\.\s+Remove a step or undo it to keep incidents again\.$/);
  expect(screen.queryByText("Map of the kept incidents", { selector: "p" })).toBeNull();
});
