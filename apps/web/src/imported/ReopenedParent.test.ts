import { expect, it } from "vitest";
import { ImportedInvestigationCoordinator, shownSelection, type Restoration } from "./coordinator";
import { selectionContract } from "../map/client";
import { identity, populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { savedContent, investigationId, secondRevisionId } from "../test/saving";
import { contains, graphAnswer, opened, scriptedSelectionClient, selectionAnswer, selectionRefusal, support } from "../test/selections";
import { scriptedViewClient } from "../test/views";

const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const populationId = (digit: string) => `population.v1:sha256:${digit.repeat(64)}`;

function setup(parentCaseIds: string[], openInstead = false) {
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const coordinator = new ImportedInvestigationCoordinator(imports.client, selecting.client, scriptedViewClient().client);
  const steps = [contains(opened)];
  const selectedIdentity = { ...identity, population_id: populationId("5") };
  const restoration: Restoration = {
    target: { workspaceId, preparationId }, steps, parentCaseIds, selectionIdentity: selectedIdentity,
    binding: { investigationId, revisionId: secondRevisionId, content: {
      ...savedContent, base_identity: identity, selection_identity: selectedIdentity,
      selection_recipe: { parent_case_ids: parentCaseIds, predicates: steps }, comparison: null,
    } }, view: "map",
  };
  const published = [] as ReturnType<typeof shownSelection>[];
  const unsubscribe = coordinator.subscribe(() => published.push(shownSelection(coordinator.getState().selection)));
  if (openInstead) coordinator.open({ workspaceId, preparationId });
  else coordinator.restore(restoration);
  let selections = 0, graphs = 0;
  const graphCases = new Map([[populationId("c"), parentCaseIds], [populationId("f"), ["A-1", "B-2"]], [populationId("5"), parentCaseIds.filter(id => id === "A-1")]]);

  async function answerSelection() {
    const call = selecting.selections[selections++];
    expect(selectionContract.selectCasesRequest(call.request)).toBe(true);
    const parent = call.request.parent_case_ids ?? ["A-1", "B-2"];
    const kept = call.request.predicates.length ? parent.filter(id => id === "A-1") : parent;
    const removed = parent.filter(id => !kept.includes(id));
    const records = (ids: string[]) => ids.reduce((n,id) => n + (id === "A-1" ? 2 : 1), 0);
    const digit = call.request.predicates.length ? "5" : call.request.parent_case_ids === null ? "f" : "c";
    const answer = selectionAnswer(call.request, {
      population: digit, kept: support(kept, records(kept)), removed: support(removed, records(removed)), unevaluable: support([], 0),
      results: call.request.predicates.map(() => ({ kept: support(kept, records(kept)), removed: support(removed, records(removed)), unevaluable: support([], 0) })),
    });
    answer.parent = support(parent, records(parent));
    answer.parent_identity = { ...identity, population_id: populationId(call.request.parent_case_ids === null ? "f" : "c") };
    expect(selectionContract.selectionAnswer(answer)).toBe(true);
    call.reply({ ok: true, answer }); await tick();
  }

  async function drain(holdParent = false) {
    let held: typeof selecting.graphs[number] | null = null;
    for (let turn = 0; turn < 12; turn++) {
      await tick();
      let progress = false;
      while (selections < selecting.selections.length) { await answerSelection(); progress = true; }
      while (graphs < selecting.graphs.length) {
        const call = selecting.graphs[graphs++];
        expect(selectionContract.processGraphRequest(call.request)).toBe(true);
        if (holdParent && call.request.identity.population_id === populationId("c")) { held = call; progress = true; continue; }
        const caseIds = graphCases.get(call.request.identity.population_id);
        expect(caseIds).toBeDefined();
        const answer = graphAnswer(call.request, caseIds!);
        expect(selectionContract.processGraphAnswer(answer)).toBe(true);
        call.reply({ ok: true, answer }); await tick(); progress = true;
      }
      if (!progress) break;
    }
    return held;
  }

  return { imports, selecting, coordinator, restoration, published, unsubscribe, drain };
}

it.each([{ parent: ["A-1"] }, { parent: [] as string[] }])("hydrates the exact named parent $parent without presenting it as the saved selection", async ({ parent }) => {
  const app = setup(parent);
  app.imports.populations[0].reply({ ok: true, answer: populationAnswer(app.imports.populations[0].request) });
  await app.drain();
  const state = app.coordinator.getState();
  expect(state.parentGraph?.meta.selected_case_ids).toEqual(parent);
  expect(shownSelection(state.selection)?.answer.identity).toEqual(app.restoration.selectionIdentity);
  expect(shownSelection(state.selection)?.steps).toEqual(app.restoration.steps);
  for (const shown of app.published) if (shown) {
    expect(shown.steps).toEqual(app.restoration.steps);
    expect(shown.answer.kept.case_ids).toEqual(parent.filter(id => id === "A-1"));
  }
  app.unsubscribe(); app.coordinator.stop();
});

it.each(["stop", "new question"] as const)("drops the held parent graph after %s", async (action) => {
  const app = setup(["A-1"]);
  app.imports.populations[0].reply({ ok: true, answer: populationAnswer(app.imports.populations[0].request) });
  const held = await app.drain(true);
  expect(held).not.toBeNull();
  if (action === "stop") app.coordinator.stop();
  else {
    app.coordinator.open({ workspaceId, preparationId });
    const population = app.imports.populations[1];
    population.reply({ ok: true, answer: populationAnswer(population.request) });
    await app.drain();
    expect(app.coordinator.getState().parentGraph?.meta.selected_case_ids).toEqual(["A-1", "B-2"]);
  }
  const before = app.coordinator.getState();
  held!.reply({ ok: true, answer: graphAnswer(held!.request, ["A-1"]) });
  await tick();
  expect(app.coordinator.getState()).toBe(before);
  app.unsubscribe(); app.coordinator.stop();
});

it("retains the prior selected map when the restored population cannot be opened", async () => {
  const app = setup(["A-1"], true);
  app.imports.populations[0].reply({ ok: true, answer: populationAnswer(app.imports.populations[0].request) });
  await app.drain();
  const before = app.coordinator.getState();
  expect(before.parentGraph?.meta.selected_case_ids).toEqual(["A-1", "B-2"]);
  app.coordinator.restore(app.restoration);
  expect(app.coordinator.getState().parentGraph).toBe(before.parentGraph);
  app.imports.populations[1].reply({ ok: false, problem: { kind: "unreachable" } });
  await tick();
  const failed = app.coordinator.getState();
  expect(failed.replacement?.phase).toBe("failed");
  expect(failed.parentGraph).toBe(before.parentGraph);
  expect(shownSelection(failed.selection)).toBe(shownSelection(before.selection));
  app.coordinator.stay();
  expect(app.coordinator.getState().parentGraph).toBe(before.parentGraph);
  app.unsubscribe(); app.coordinator.stop();
});

it.each(["workspace", "membership"] as const)("refuses a parent graph with the wrong %s", async (wrong) => {
  const app = setup(["A-1"]);
  app.imports.populations[0].reply({ ok: true, answer: populationAnswer(app.imports.populations[0].request) });
  const held = await app.drain(true);
  expect(held).not.toBeNull();
  const answer = graphAnswer(held!.request, wrong === "membership" ? ["A-1", "B-2"] : ["A-1"]);
  if (wrong === "workspace") answer.workspace_id = `${workspaceId}-other`;
  expect(selectionContract.processGraphAnswer(answer)).toBe(true);
  held!.reply({ ok: true, answer }); await tick();
  const state = app.coordinator.getState();
  expect(state.parentGraph).toBeNull();
  expect(state.selection.phase).toBe("failed");
  expect(shownSelection(state.selection)?.answer.identity).toEqual(app.restoration.selectionIdentity);
  app.unsubscribe(); app.coordinator.stop();
});

it("retries a parent graph failure with the same saved parent and steps", async () => {
  const app = setup(["A-1"]);
  app.imports.populations[0].reply({ ok: true, answer: populationAnswer(app.imports.populations[0].request) });
  const held = await app.drain(true);
  expect(held).not.toBeNull();
  const before = shownSelection(app.coordinator.getState().selection);
  held!.reply(selectionRefusal(held!.request, "process_graph", "computation_failed", "Parent map unavailable."));
  await tick();
  expect(app.coordinator.getState().selection.phase).toBe("failed");
  expect(shownSelection(app.coordinator.getState().selection)).toBe(before);
  expect(app.coordinator.getState().parentGraph).toBeNull();
  app.coordinator.retrySelection();
  await app.drain();
  expect(app.coordinator.getState().parentGraph?.meta.selected_case_ids).toEqual(["A-1"]);
  expect(shownSelection(app.coordinator.getState().selection)?.steps).toEqual(app.restoration.steps);
  expect(app.selecting.selections.at(-1)?.request.parent_case_ids).toEqual(["A-1"]);
  app.unsubscribe(); app.coordinator.stop();
});

it("cancels pending hydration when the saved step is removed without broadening its parent", async () => {
  const app = setup(["A-1"]);
  app.imports.populations[0].reply({ ok: true, answer: populationAnswer(app.imports.populations[0].request) });
  const held = await app.drain(true);
  expect(held).not.toBeNull();
  app.coordinator.clearSteps();
  expect(held!.signal.aborted).toBe(true);
  await app.drain();
  const before = app.coordinator.getState();
  expect(before.parentGraph?.meta.selected_case_ids).toEqual(["A-1"]);
  expect(shownSelection(before.selection)?.steps).toEqual([]);
  expect(shownSelection(before.selection)?.answer.kept.case_ids).toEqual(["A-1"]);
  held!.reply({ ok: true, answer: graphAnswer(held!.request, ["A-1"]) }); await tick();
  expect(app.coordinator.getState()).toBe(before);
  app.unsubscribe(); app.coordinator.stop();
});
