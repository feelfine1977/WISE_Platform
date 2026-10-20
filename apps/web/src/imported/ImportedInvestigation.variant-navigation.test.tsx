import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { closed, everyIncident, graphAnswer, opened, scriptedSelectionClient, selectionAnswer } from "../test/selections";
import { scriptedViewClient, variantIds } from "../test/views";
import type { VariantsAnswer, VariantsRequest } from "../views/messages";
import { ImportedInvestigation } from "./ImportedInvestigation";
import { ImportedInvestigationCoordinator } from "./coordinator";

vi.mock("../map/MapView", () => ({
  MapView: () => <p>Map of the kept incidents</p>,
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
      variants: [{
        id: variantIds[0],
        activities: [opened, closed],
        case_count: 1,
        share: 1,
        denominator: 1,
        case_ids: ["A-1"],
        record_count: 2,
        omitted_activity_record_count: 0,
      }],
      unevaluable: { case_ids: ["B-2"], case_count: 1, record_count: 1, omitted_activity_record_count: 0 },
    },
  };
}

it("opens the incident table from Map when a variant is listed, without changing the analytical selection", async () => {
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const views = scriptedViewClient();
  const coordinator = new ImportedInvestigationCoordinator(imports.client, selecting.client, views.client);
  const user = userEvent.setup();
  render(<ImportedInvestigation coordinator={coordinator} onShowData={() => undefined} />);

  act(() => coordinator.open({ workspaceId, preparationId }));
  await deliver(() => imports.populations[0].reply({ ok: true, answer: populationAnswer(imports.populations[0].request) }));
  await deliver(() => selecting.selections[0].reply({ ok: true, answer: selectionAnswer(selecting.selections[0].request, everyIncident) }));
  await deliver(() => selecting.graphs[0].reply({ ok: true, answer: graphAnswer(selecting.graphs[0].request, ["A-1", "B-2"]) }));
  expect(coordinator.getState().selection.phase).toBe("ready");
  const variantRequest = views.variants.at(-1)!;
  await deliver(() => variantRequest.reply({ ok: true, answer: variantsOfTheTwoIncidents(variantRequest.request) }));

  await user.click(screen.getByRole("button", { name: /^Map$/ }));
  expect(screen.getByRole("button", { name: /^Map$/ }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("table", { name: "Kept incidents" })).toBeNull();
  const state = coordinator.getState();
  const analytical = structuredClone({ population: state.population, selection: state.selection, parentGraph: state.parentGraph });
  const facts = screen.getByLabelText("Population").textContent;
  const requests = [imports.populations.length, selecting.selections.length, selecting.graphs.length, views.openings.length, views.variants.length];

  // The variants are a view of the centre, named beside the map and the incidents (#54).
  await user.click(within(screen.getByRole("group", { name: "View" })).getByRole("button", { name: "Variants" }));
  expect(screen.getByRole("heading", { name: "Variants of the kept incidents" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "List the 1 incident of variant 1 in the table" }));

  expect(screen.getByRole("button", { name: /^Incidents$/ }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: /^Map$/ }).getAttribute("aria-pressed")).toBe("false");
  const table = screen.getByRole("table", { name: "Kept incidents of variant 1" });
  expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["A-1"]);
  const after = coordinator.getState();
  expect({ population: after.population, selection: after.selection, parentGraph: after.parentGraph }).toEqual(analytical);
  expect(screen.getByLabelText("Population").textContent).toBe(facts);
  expect([imports.populations.length, selecting.selections.length, selecting.graphs.length, views.openings.length, views.variants.length]).toEqual(requests);
});
