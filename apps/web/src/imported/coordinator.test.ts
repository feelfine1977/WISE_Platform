import { SavingCoordinator } from "../saved/coordinator";
import { scriptedSavingClient } from "../test/saving";
import { describe, expect, it } from "vitest";
import { selectionContract } from "../map/client";
import { evidenceAnswer, identity, populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import {
  bothSteps,
  checked,
  closed,
  contains,
  containingOpened,
  everyIncident,
  type Figures,
  follows,
  followingOpened,
  graphAnswer,
  opened,
  scriptedSelectionClient,
  selectionAnswer,
  selectionRefusal,
  support,
  withoutOpened,
} from "../test/selections";
import { ImportedInvestigationCoordinator, shownSelection } from "./coordinator";

/** Lets the replies the test delivered reach the coordinator. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function opening() {
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const coordinator = new ImportedInvestigationCoordinator(imports.client, selecting.client);
  coordinator.open({ workspaceId, preparationId });
  imports.populations[0].reply({ ok: true, answer: populationAnswer(imports.populations[0].request) });
  await settle();
  return { imports, selecting, coordinator };
}

type Opened = Awaited<ReturnType<typeof opening>>;

/** Answers the selection request at a place with the given figures, and its map with the kept incidents. */
async function answer(app: Opened, place: number, figures: Figures) {
  const selection = app.selecting.selections[place];
  selection.reply({ ok: true, answer: selectionAnswer(selection.request, figures) });
  await settle();
  const graph = app.selecting.graphs.find((call) => call.request.query_revision === selection.request.query_revision);
  graph?.reply({ ok: true, answer: graphAnswer(graph.request, figures.kept.case_ids) });
  await settle();
}

function asked(app: Opened) {
  return app.selecting.selections.map((call) => call.request.predicates.slice(0, call.request.active_step_count ?? call.request.predicates.length));
}

function chips(app: Opened) {
  return shownSelection(app.coordinator.getState().selection)?.answer.predicate_results.map((result) => result.predicate) ?? null;
}

describe("the selection of whole incidents of an imported preparation", () => {
  it("selects every incident of the parent first and keeps that map as the parent's", async () => {
    const app = await opening();
    const request = app.selecting.selections[0].request;
    expect(selectionContract.selectCasesRequest(request)).toBe(true);
    expect(request).toMatchObject({ query_revision: 2, workspace_id: workspaceId, identity, parent_case_ids: null, predicates: [] });

    app.selecting.selections[0].reply({ ok: true, answer: selectionAnswer(request, everyIncident) });
    await settle();
    const graphRequest = app.selecting.graphs[0].request;
    expect(selectionContract.processGraphRequest(graphRequest)).toBe(true);
    expect(graphRequest.query_revision).toBe(2);
    expect(graphRequest.identity.population_id).toBe(`population.v1:sha256:${"f".repeat(64)}`);
    const supplied = graphAnswer(graphRequest, ["A-1", "B-2"]);
    expect(selectionContract.processGraphAnswer(supplied)).toBe(true);
    app.selecting.graphs[0].reply({ ok: true, answer: supplied });
    await settle();

    const state = app.coordinator.getState();
    expect(state.selection.phase).toBe("ready");
    expect(state.parentGraph).toEqual(supplied.graph);
    expect(shownSelection(state.selection)?.answer.kept.case_ids).toEqual(["A-1", "B-2"]);

    app.coordinator.addStep(contains(opened));
    await answer(app, 1, containingOpened);
    // The parent's map stays the map of every incident, not the map of the kept ones.
    expect(app.coordinator.getState().parentGraph).toEqual(supplied.graph);
  });

  it("adds, removes, clears, undoes and redoes steps, each answered as a new selection", async () => {
    const app = await opening();
    await answer(app, 0, everyIncident);

    app.coordinator.addStep(contains(opened));
    await answer(app, 1, containingOpened);
    expect(chips(app)).toEqual([contains(opened)]);
    app.coordinator.addStep(follows(opened, closed));
    await answer(app, 2, bothSteps);
    expect(chips(app)).toEqual([contains(opened), follows(opened, closed)]);
    app.coordinator.removeStep(contains(opened));
    await answer(app, 3, followingOpened);
    expect(chips(app)).toEqual([follows(opened, closed)]);
    app.coordinator.clearSteps();
    await answer(app, 4, everyIncident);
    expect(chips(app)).toEqual([]);
    app.coordinator.undo();
    await answer(app, 5, followingOpened);
    app.coordinator.undo();
    await answer(app, 6, bothSteps);
    app.coordinator.redo();
    await answer(app, 7, followingOpened);

    expect(asked(app)).toEqual([
      [],
      [contains(opened)],
      [contains(opened), follows(opened, closed)],
      [follows(opened, closed)],
      [],
      [follows(opened, closed)],
      [contains(opened), follows(opened, closed)],
      [follows(opened, closed)],
    ]);
    expect(app.selecting.selections.map((call) => call.request.query_revision)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    const shown = shownSelection(app.coordinator.getState().selection);
    expect(shown?.answer.unevaluable.case_ids).toEqual(["B-2"]);
    expect(shown?.graph.meta.selected_case_ids).toEqual(["A-1"]);

    app.coordinator.redo();
    await answer(app, 8, everyIncident);
    expect(asked(app)[8]).toEqual([]);

    // Nothing left to redo, nothing to clear and a step not taken change nothing and ask for nothing.
    app.coordinator.redo();
    app.coordinator.clearSteps();
    app.coordinator.removeStep(contains(checked));
    expect(app.selecting.selections).toHaveLength(9);
    // Nor does a step already taken.
    app.coordinator.addStep(contains(checked));
    app.coordinator.addStep(contains(checked));
    expect(asked(app).slice(9)).toEqual([[contains(checked)]]);
  });

  it("drops a late selection, a late map and a late refusal of an earlier revision", async () => {
    const app = await opening();
    await answer(app, 0, everyIncident);
    app.coordinator.addStep(contains(opened));
    app.coordinator.addStep(contains(opened, true));
    expect(app.selecting.selections[1].signal.aborted).toBe(true);
    // The analyst undid before the first answer came; that undo asks again for the first step.
    app.coordinator.undo();

    const late = app.selecting.selections[1];
    late.reply({ ok: true, answer: selectionAnswer(late.request, containingOpened) });
    await settle();
    expect(app.selecting.graphs).toHaveLength(1);
    app.selecting.selections[2].reply(selectionRefusal(app.selecting.selections[2].request, "select_cases", "computation_failed", "Too late."));
    await settle();
    expect(app.coordinator.getState().selection.phase).toBe("loading");

    const current = app.selecting.selections[3];
    expect(current.request.predicates).toEqual([contains(opened), contains(opened, true)]);
    expect(current.request.active_step_count).toBe(1);
    current.reply({ ok: true, answer: selectionAnswer(current.request, containingOpened) });
    await settle();
    // A newer step is taken while the map of this one is still being drawn: that map arrives late.
    app.coordinator.redo();
    const lateGraph = app.selecting.graphs[1];
    lateGraph.reply({ ok: true, answer: graphAnswer(lateGraph.request, ["A-1"]) });
    await settle();
    expect(app.coordinator.getState().selection.phase).toBe("loading");
    expect(shownSelection(app.coordinator.getState().selection)?.steps).toEqual([]);

    // Redone: both steps again, which keep no incident.
    await answer(app, 4, {
      population: "9",
      kept: support([], 0),
      removed: support(["A-1", "B-2"], 3),
      unevaluable: support([], 0),
      results: [containingOpened.results[0], withoutOpened.results[0]],
    });
    const state = app.coordinator.getState();
    expect(state.selection.phase).toBe("ready");
    expect(chips(app)).toEqual([contains(opened), contains(opened, true)]);
    expect(shownSelection(state.selection)?.graph.meta.selected_case_ids).toEqual([]);
  });

  it("keeps the selection shown when a new one is refused, and tries the new one again", async () => {
    const app = await opening();
    await answer(app, 0, everyIncident);
    app.coordinator.addStep(contains(opened));
    const refused = app.selecting.selections[1];
    refused.reply(selectionRefusal(refused.request, "select_cases", "computation_failed", "The answer could not be computed."));
    await settle();

    const state = app.coordinator.getState().selection;
    expect(state.phase).toBe("failed");
    expect(shownSelection(state)?.steps).toEqual([]);
    expect(state.phase === "failed" && state.history.present).toEqual([contains(opened)]);
    app.coordinator.retrySelection();
    expect(asked(app).at(-1)).toEqual([contains(opened)]);
    await answer(app, 2, containingOpened);
    expect(chips(app)).toEqual([contains(opened)]);
  });

  it("stays with the selection shown when a new one is refused, with the steps and undo of that selection", async () => {
    const app = await opening();
    await answer(app, 0, everyIncident);
    app.coordinator.addStep(contains(opened));
    await answer(app, 1, containingOpened);
    app.coordinator.addStep(follows(opened, closed));
    const refused = app.selecting.selections[2];
    refused.reply(selectionRefusal(refused.request, "select_cases", "computation_failed", "The answer could not be computed."));
    await settle();
    expect(app.coordinator.getState().selection.phase).toBe("failed");

    app.coordinator.staySelection();
    const state = app.coordinator.getState().selection;
    expect(state.phase).toBe("ready");
    expect(state.phase !== "idle" && state.history).toEqual({ past: [[]], present: [contains(opened)], future: [] });
    expect(chips(app)).toEqual([contains(opened)]);
    expect(shownSelection(state)?.answer.kept.case_ids).toEqual(["A-1"]);
    expect(app.selecting.selections).toHaveLength(3);

    // Undo goes back from the selection shown, not from the steps that were refused.
    app.coordinator.undo();
    expect(asked(app).at(-1)).toEqual([]);
  });

  it("refuses a reply that answers other steps or another population", async () => {
    const app = await opening();
    await answer(app, 0, everyIncident);
    app.coordinator.addStep(contains(opened));
    const call = app.selecting.selections[1];
    const other = selectionAnswer({ ...call.request, predicates: [contains(closed)] }, containingOpened);
    call.reply({ ok: true, answer: other });
    await settle();

    const state = app.coordinator.getState().selection;
    expect(state.phase === "failed" && state.problem).toEqual({ kind: "unsupported_reply", detail: "The reply answers different steps." });
    expect(app.selecting.graphs).toHaveLength(1);
  });

  it("opens the complete history of a kept incident under the selection shown, and follows the selection", async () => {
    const app = await opening();
    await answer(app, 0, everyIncident);
    app.coordinator.openCase("A-1");
    const first = app.imports.evidence[0].request;
    expect(first.identity.population_id).toBe(`population.v1:sha256:${"f".repeat(64)}`);
    app.imports.evidence[0].reply({ ok: true, answer: evidenceAnswer(first) });
    await settle();

    // A-1 is kept: its history is asked for again under the new selection's identity.
    app.coordinator.addStep(contains(opened));
    await answer(app, 1, containingOpened);
    const again = app.imports.evidence[1].request;
    expect(again.case_id).toBe("A-1");
    expect(again.identity.population_id).toBe(`population.v1:sha256:${"5".repeat(64)}`);
    expect(again.query_revision).toBe(3);
    app.imports.evidence[1].reply({ ok: true, answer: evidenceAnswer(again) });
    await settle();
    expect(app.coordinator.getState().inspected.phase).toBe("ready");

    // A-1 is removed: the inspector closes rather than show an incident outside the selection.
    app.coordinator.removeStep(contains(opened));
    app.coordinator.addStep(contains(opened, true));
    await answer(app, 3, withoutOpened);
    expect(app.coordinator.getState().inspected).toEqual({ phase: "closed" });
    expect(app.imports.evidence).toHaveLength(2);
  });

  it("asks again for a history whose request a new selection abandoned", async () => {
    const app = await opening();
    await answer(app, 0, everyIncident);
    app.coordinator.openCase("B-2");
    app.coordinator.addStep(contains(opened, true));
    expect(app.imports.evidence[0].signal.aborted).toBe(true);
    app.imports.evidence[0].reply({ ok: true, answer: evidenceAnswer(app.imports.evidence[0].request) });
    await settle();
    expect(app.coordinator.getState().inspected.phase).toBe("loading");

    await answer(app, 1, withoutOpened);
    expect(app.imports.evidence[1].request.identity.population_id).toBe(`population.v1:sha256:${"8".repeat(64)}`);
    expect(app.imports.evidence[1].request.case_id).toBe("B-2");
  });
});


describe("supplied ordered prefixes under one query revision", () => {
  it("selects an earlier prefix with the full future trail, then Undo/Redo and a new branch preserve exact active questions", async () => {
    const app=await opening();await answer(app,0,everyIncident);
    app.coordinator.addStep(contains(opened));await answer(app,1,containingOpened);
    app.coordinator.addStep(follows(opened,closed));await answer(app,2,bothSteps);
    app.coordinator.chooseStep(1);
    const prefix=app.selecting.selections[3].request;
    expect(prefix.predicates).toEqual([contains(opened),follows(opened,closed)]);expect(prefix.active_step_count).toBe(1);
    await answer(app,3,containingOpened);
    expect(shownSelection(app.coordinator.getState().selection)?.steps).toEqual([contains(opened)]);
    app.coordinator.undo();expect(app.selecting.selections[4].request.active_step_count).toBe(0);
    await answer(app,4,everyIncident);
    app.coordinator.redo();expect(app.selecting.selections[5].request.active_step_count).toBe(1);await answer(app,5,containingOpened);
    app.coordinator.redo();expect(app.selecting.selections[6].request.active_step_count).toBe(2);await answer(app,6,bothSteps);
    app.coordinator.chooseStep(1);await answer(app,7,containingOpened);
    app.coordinator.addStep(contains(checked));
    expect(app.selecting.selections[8].request.predicates).toEqual([contains(opened),contains(checked)]);
    expect(app.selecting.selections[8].request.active_step_count).toBe(2);
    expect(app.coordinator.getState().selection.phase!=="idle" && app.coordinator.getState().selection).toBeTruthy();
  });

  it.each(["active", "numbering", "binding", "partition", "source"] as const)("refuses a %s mismatch instead of publishing mixed trail evidence",async(kind)=>{
    const app=await opening();await answer(app,0,everyIncident);
    app.coordinator.addStep(contains(opened));const call=app.selecting.selections[1];const supplied=selectionAnswer(call.request,containingOpened);
    if(kind==="active")supplied.active_step_count=0;
    if(kind==="numbering")supplied.step_results[0].step_number=2;
    if(kind==="binding")supplied.step_results[0].predicate=contains(closed);
    if(kind==="partition")supplied.step_results[0].kept=support(["A-1","B-2"],3);
    if(kind==="source")supplied.identity={...supplied.identity,source_id:"source.v1:sha256:"+"0".repeat(64)};
    call.reply({ok:true,answer:supplied});await settle();
    expect(app.coordinator.getState().selection.phase).toBe("failed");
    expect(shownSelection(app.coordinator.getState().selection)?.steps).toEqual([]);
    expect(app.selecting.graphs).toHaveLength(1);
  });
});


it("saves only the active prefix and its exact answered identity while later steps remain in the session trail",async()=>{
 const app=await opening();await answer(app,0,everyIncident);app.coordinator.addStep(contains(opened));await answer(app,1,containingOpened);
 app.coordinator.addStep(follows(opened,closed));await answer(app,2,bothSteps);app.coordinator.chooseStep(1);await answer(app,3,containingOpened);
 const saves=scriptedSavingClient();const saving=new SavingCoordinator(saves.client,app.coordinator);saving.save("Prefix","","incidents");
 expect(saves.saves[0].request.selection_recipe.predicates).toEqual([contains(opened)]);
 expect(saves.saves[0].request.selection_identity).toEqual(shownSelection(app.coordinator.getState().selection)?.answer.identity);
 expect(app.selecting.selections[3].request.predicates).toEqual([contains(opened),follows(opened,closed)]);
});


describe("structural accounting of every supplied trail prefix", () => {
  it.each([0, 1, 2])("refuses impossible non-active supports with active prefix %s", async (active) => {
    for (const mutation of ["foreign", "cardinality", "overlap", "missing", "raw-total", "raw-swap", "duplicate", "negative-raw"]) {
      const app = await opening(); await answer(app, 0, everyIncident);
      app.coordinator.addStep(contains(opened)); await answer(app, 1, containingOpened);
      app.coordinator.addStep(follows(opened, closed));
      let index = 2;
      if (active !== 2) { await answer(app, 2, bothSteps); app.coordinator.chooseStep(active); index = 3; }
      const call = app.selecting.selections[index];
      const reply = structuredClone(selectionAnswer(call.request, active === 0 ? everyIncident : active === 1 ? containingOpened : bothSteps));
      const target = active === 2 ? 0 : 1;
      reply.step_results[target] = structuredClone(reply.step_results[target]);
      const prefix = reply.step_results[target];
      if (mutation === "foreign") prefix.kept.case_ids = ["FOREIGN-INCIDENT"];
      if (mutation === "cardinality") prefix.kept.case_count = 123;
      if (mutation === "overlap") prefix.unevaluable = support(["A-1"], 2);
      if (mutation === "missing") { prefix.removed = support([], 0); prefix.unevaluable = support([], 0); }
      if (mutation === "raw-total") prefix.kept.record_count += 1;
      if (mutation === "raw-swap") { prefix.kept.record_count -= 1; (prefix.unevaluable.case_count ? prefix.unevaluable : prefix.removed).record_count += 1; }
      if (mutation === "duplicate") { prefix.kept.case_ids.push("A-1"); prefix.kept.case_count += 1; prefix.kept.record_count += 2; }
      if (mutation === "negative-raw") prefix.kept.record_count = -1;
      const beforeGraphs = app.selecting.graphs.length;
      const beforeShown = shownSelection(app.coordinator.getState().selection);
      call.reply({ ok: true, answer: reply }); await settle();
      expect(app.coordinator.getState().selection.phase, `${active}/${mutation}`).toBe("failed");
      expect(shownSelection(app.coordinator.getState().selection)).toBe(beforeShown);
      expect(app.selecting.graphs).toHaveLength(beforeGraphs);
    }
  });
});
