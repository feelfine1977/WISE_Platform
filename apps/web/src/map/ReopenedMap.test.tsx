import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as flow from "wise-flow";
import { importContract } from "../data/client";
import type { ImportedPopulationAnswer, OpenPopulationRequest } from "../generated/imports";
import type { AnswerIdentity, ProcessGraphAnswer, ProcessGraphRequest, SelectCasesRequest, SelectionAnswer, SuppliedGraph } from "../generated/selection";
import { ImportedInvestigationCoordinator, type Restoration, shownSelection } from "../imported/coordinator";
import { ImportedInvestigation } from "../imported/ImportedInvestigation";
import { identity, populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { firstRevisionId, investigationId, savedContent } from "../test/saving";
import { checked, closed, contains, nodeIds, opened, support, suppliedGraph } from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { selectionContract, type SelectionClient } from "./client";

vi.mock("wise-flow", async (original) => {
  const library = await original<typeof import("wise-flow")>();
  return { ...library, layoutUnion: vi.fn(library.layoutUnion) };
});

class StillObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StillObserver;

/*
 * A literal nine-incident fixture, separate from analytics qualification: A-1 through A-7 each
 * have Eröffnet, Geschlossen. A-8 has Eröffnet, Geschlossen, Eröffnet, Geschlossen. B-2 has one
 * Prüfung record with unknown order. Every mapped label is retained: parent 9/19, contains
 * Eröffnet 8/18; a smaller saved parent {A-1,B-2} is 2/3 and its kept side is 1/2.
 */
const allIds = ["A-1", "A-2", "A-3", "A-4", "A-5", "A-6", "A-7", "A-8", "B-2"];
const cases = allIds.map((case_id) => ({
  case_id,
  record_count: case_id === "A-8" ? 4 : case_id === "B-2" ? 1 : 2,
  mapped_record_count: case_id === "A-8" ? 4 : case_id === "B-2" ? 1 : 2,
  omitted_activity_record_count: 0,
  sequence_evaluable: case_id !== "B-2",
}));
const records = (ids: string[]) => ids.reduce((count, id) => count + cases.find((item) => item.case_id === id)!.record_count, 0);
const populationId = (digit: string) => `population.v1:sha256:${digit.repeat(64)}`;
const binding = (digit: string): AnswerIdentity => ({ ...identity, population_id: populationId(digit) });
const coordinators: ImportedInvestigationCoordinator[] = [];

beforeEach(() => { vi.mocked(flow.layoutUnion).mockClear(); });
afterEach(() => { for (const coordinator of coordinators.splice(0)) coordinator.stop(); });

function nineIncidents(request: OpenPopulationRequest): ImportedPopulationAnswer {
  const answer = {
    ...populationAnswer(request),
    source: { ...populationAnswer(request).source, filename: "Reopened incidents.csv", byte_count: 2048 },
    population: support(allIds, 19),
    coverage: { raw_record_count: 19, mapped_record_count: 19, omitted_activity_record_count: 0 },
    unassigned_record_count: 0,
    cases,
  };
  expect(importContract.populationAnswer(answer)).toBe(true);
  return answer;
}

/** The supplied graph of the fixture's complete histories, never the graph of another parent. */
function fixtureGraph(ids: string[]): SuppliedGraph {
  const a = ids.filter((id) => id !== "B-2");
  const hasB = ids.includes("B-2");
  const repeats = ids.includes("A-8") ? 1 : 0;
  const passages = a.length + repeats;
  const template = suppliedGraph([...(a.length ? ["A-1"] : []), ...(hasB ? ["B-2"] : [])]);
  const graph: SuppliedGraph = {
    ...template,
    nodes: template.nodes.map((node) => node.label === checked ? node : {
      ...node,
      metrics: { count: passages, events: passages, cases: a.length, starts: node.label === opened ? a.length : 0, ends: node.label === closed ? a.length : 0 },
    }),
    edges: template.edges.map((edge) => ({
      ...edge,
      metrics: { count: passages, cases: a.length, medianLagHours: 25.5, usableLagCount: passages },
      payload: { ...edge.payload, case_ids: a },
    })),
    meta: {
      ...template.meta,
      selected_case_ids: ids,
      sequence_evaluable_case_ids: a,
      sequence_unevaluable_case_ids: hasB ? ["B-2"] : [],
      selected_case_count: ids.length,
      cases: ids.length,
      events: records(ids),
      raw_record_count: records(ids),
      mapped_record_count: records(ids),
      sequence_evaluable_case_count: a.length,
      sequence_unevaluable_case_count: hasB ? 1 : 0,
      sequence_unevaluable_record_count: hasB ? 1 : 0,
      node_case_denominator: ids.length,
      path_case_denominator: a.length,
    },
  };
  if (repeats) {
    graph.edges.push({
      ...graph.edges[0],
      id: `path.v1:sha256:${"e".repeat(64)}`,
      source: nodeIds[closed], target: nodeIds[opened],
      metrics: { count: 1, cases: 1, medianLagHours: 12, usableLagCount: 1 },
      payload: { ...graph.edges[0].payload, source_activity: closed, target_activity: opened, case_ids: ["A-8"] },
    });
  }
  return graph;
}

async function restored(parentIds: string[], hasStep: boolean) {
  const imports = scriptedImportClient();
  const parentIdentity = binding(parentIds.length === 9 ? "f" : "d");
  const selectedIdentity = hasStep ? binding(parentIds.length === 9 ? "5" : "6") : parentIdentity;
  const steps = hasStep ? [contains(opened)] : [];
  const selectedIds = hasStep ? parentIds.filter((id) => id !== "B-2") : parentIds;
  const selections: SelectCasesRequest[] = [];
  const graphs: ProcessGraphRequest[] = [];
  const client: SelectionClient = {
    selectCases: async (request) => {
      selections.push(request);
      expect(request.parent_case_ids).toEqual(parentIds);
      expect([[], steps]).toContainEqual(request.predicates);
      const kept = request.predicates.length ? selectedIds : parentIds;
      const removed = parentIds.filter((id) => !kept.includes(id));
      const result = { kept: support(kept, records(kept)), removed: support(removed, records(removed)), unevaluable: support([], 0) };
      const answer: SelectionAnswer = {
        schema_version: 1, message_type: "selection_answer", request_id: request.request_id,
        query_revision: request.query_revision, workspace_id: request.workspace_id,
        identity: request.predicates.length ? selectedIdentity : parentIdentity,
        parent_identity: parentIdentity, parent: support(parentIds, records(parentIds)), ...result,
        predicate_results: request.predicates.map((predicate) => ({ predicate, ...result })),
      };
      expect(selectionContract.selectionAnswer(answer)).toBe(true);
      return { ok: true, answer };
    },
    processGraph: async (request) => {
      graphs.push(request);
      const ids = request.identity.population_id === parentIdentity.population_id ? parentIds : selectedIds;
      expect([parentIdentity, selectedIdentity]).toContainEqual(request.identity);
      const answer: ProcessGraphAnswer = {
        schema_version: 1, message_type: "process_graph_answer", request_id: request.request_id,
        query_revision: request.query_revision, workspace_id: request.workspace_id,
        identity: request.identity, graph: fixtureGraph(ids),
      };
      expect(selectionContract.processGraphAnswer(answer)).toBe(true);
      return { ok: true, answer };
    },
  };
  const coordinator = new ImportedInvestigationCoordinator(imports.client, client, scriptedViewClient().client);
  coordinators.push(coordinator);
  const published: ReturnType<typeof shownSelection>[] = [];
  const unsubscribe = coordinator.subscribe(() => {
    const shown = shownSelection(coordinator.getState().selection);
    if (shown) published.push(shown);
  });
  const restoration: Restoration = {
    target: { workspaceId, preparationId }, parentCaseIds: parentIds, steps, selectionIdentity: selectedIdentity,
    binding: {
      investigationId, revisionId: firstRevisionId,
      content: { ...savedContent, base_identity: identity, selection_identity: selectedIdentity, selection_recipe: { parent_case_ids: parentIds, predicates: steps }, comparison: null },
    },
    view: "map",
  };
  render(<ImportedInvestigation coordinator={coordinator} onShowData={() => undefined} />);
  act(() => coordinator.restore(restoration));
  await act(async () => imports.populations[0].reply({ ok: true, answer: nineIncidents(imports.populations[0].request) }));
  await waitFor(() => expect(coordinator.getState().selection.phase).toBe("ready"));
  return { coordinator, graphs, selections, published, unsubscribe, parentIdentity, selectedIdentity, selectedIds, steps, user: userEvent.setup() };
}

const node = (map: HTMLElement, label: keyof typeof nodeIds) => map.querySelector<HTMLElement>(`[data-id="${nodeIds[label]}"]`)!;

describe("a process map reopened with a saved selection", () => {
  it.each([
    { label: "nine-parent-eight-kept", parentIds: allIds, keptRecords: 18, parentRecords: 19 },
    { label: "smaller-named-parent", parentIds: ["A-1", "B-2"], keptRecords: 2, parentRecords: 3 },
  ])("hydrates the true parent without replacing the saved question: $label", async ({ parentIds, keptRecords, parentRecords }) => {
    const app = await restored(parentIds, true);
    expect(shownSelection(app.coordinator.getState().selection)).toMatchObject({
      steps: [contains(opened)], answer: { identity: app.selectedIdentity, parent_identity: app.parentIdentity, kept: support(app.selectedIds, keptRecords) },
    });
    // The real defect leaves this spinner forever even though the selected answer is ready.
    const map = await screen.findByLabelText("Process map of the kept incidents");
    await waitFor(() => expect(node(map, opened)).not.toBeNull());
    expect(screen.queryByText("Selecting the incidents and drawing their map…")).toBeNull();
    expect(app.coordinator.getState().parentGraph?.meta).toMatchObject({ selected_case_ids: parentIds, raw_record_count: parentRecords });
    expect(app.graphs).toEqual(expect.arrayContaining([expect.objectContaining({ identity: app.parentIdentity })]));
    expect(app.graphs.every((request) => request.query_revision === shownSelection(app.coordinator.getState().selection)!.revision)).toBe(true);
    expect(app.published.length).toBeGreaterThan(0);
    for (const shown of app.published) {
      expect(shown).toMatchObject({ steps: [contains(opened)], answer: { identity: app.selectedIdentity, kept: support(app.selectedIds, keptRecords) } });
    }
    const placed = node(map, opened).style.transform;
    expect(placed).toMatch(/translate/);
    expect(node(map, checked)).toBeNull();
    expect(flow.layoutUnion).toHaveBeenCalledTimes(1);
    expect(vi.mocked(flow.layoutUnion).mock.calls[0][0][0].nodes.map((item) => item.label)).toEqual([opened, closed, checked]);

    // Clearing only the recipe reveals the same saved parent, not the entire preparation.
    await app.user.click(screen.getByRole("button", { name: "Clear all" }));
    await waitFor(() => expect(shownSelection(app.coordinator.getState().selection)?.answer.kept).toEqual(support(parentIds, parentRecords)));
    await waitFor(() => {
      expect(node(map, opened).style.transform).toBe(placed);
      expect(node(map, checked)).not.toBeNull();
    });
    expect(app.coordinator.getState().parentGraph?.meta.selected_case_ids).toEqual(parentIds);
    expect(app.selections.at(-1)?.parent_case_ids).toEqual(parentIds);
    expect(flow.layoutUnion).toHaveBeenCalledTimes(1);
    app.unsubscribe();
  });

  it("also renders a zero-step saved subset using that subset as its parent", async () => {
    const parentIds = ["A-1", "B-2"];
    const app = await restored(parentIds, false);
    const map = await screen.findByLabelText("Process map of the kept incidents");
    await waitFor(() => expect(node(map, opened)).not.toBeNull());
    expect(app.coordinator.getState().parentGraph?.meta).toMatchObject({ selected_case_ids: parentIds, raw_record_count: 3 });
    expect(shownSelection(app.coordinator.getState().selection)).toMatchObject({ steps: [], answer: { identity: app.parentIdentity, kept: support(parentIds, 3) } });
    expect(flow.layoutUnion).toHaveBeenCalledTimes(1);
    app.unsubscribe();
  });
});
