import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bpic19ProfileAnswer, Bpic19ProfileQuery } from "../generated/bpic19-profile";
import type { Bpic19ProfileProps } from "./Bpic19Profile";
import type { Bpic19MeasuresProps } from "./Bpic19Measures";
import type { Bpic19ScoringProps } from "./Bpic19Scoring";
import { measuresAnswer } from "./measures-test-fixture";
import { CompareCoordinator } from "../compare/coordinator";
import { ImportedInvestigationCoordinator, shownSelection } from "../imported/coordinator";
import { SavingCoordinator } from "../saved/coordinator";
import { scriptedComparisonClient } from "../test/comparisons";
import { earlierPreparationId, populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { firstRevisionId, saveAnswer, savedContent, scriptedSavingClient } from "../test/saving";
import { containingOpened, everyIncident, graphAnswer, scriptedSelectionClient, selectionAnswer, type Figures } from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { Bpic19Workspace } from "./Bpic19Workspace";
import { Bpic19Session } from "./session";

// Analytical panels are mocked deliberately: these tests exercise the real selection/save/session
// boundary, preserving declarations and publication validity. Analytics has separate literal tests.
const query: Bpic19ProfileQuery = {
  policy_id: "bpic19.all_raw_case_attributes.v1", profile_columns: [],
  roles: { item_category: 0, item_type: 1, goods_receipt: 2, gr_based_iv: 3, purchasing_document: 4, item: 5, source_case: 6 },
  source_interpretation: {
    profile_name: "Reviewed source A", policy_id: "bpic19.raw_source_interpretation.v1",
    inclusion: { kind: "document_start", timestamp_kind: "utc_instant", start_inclusive: "2018-01-01T00:00:00Z", end_exclusive: null },
    horizon: { timestamp_kind: "utc_instant", value: "2019-01-28T00:00:00Z", provenance: "Independent synthetic extraction contract" },
    discrepancies: [{ reference: "Independent synthetic source claim", reported_total: 251734, reported_subtotal: 251347 }],
  },
};
function reviewedAnswer(props: Bpic19ProfileProps): Bpic19ProfileAnswer {
  const chosen = props.query ?? query;
  if (!chosen.roles) throw new Error("A reviewed test answer needs reviewed roles");
  return {
    schema_version: 1, message_type: "bpic19_profile_answer", request_id: "reviewed-fixture", query_revision: props.revision,
    workspace_id: props.workspaceId, identity: props.identity, parent_identity: props.identity,
    query: chosen, binding_state: "reviewed", columns: [], suggested_roles: chosen.roles,
    profile: {
      definition_id: "bpic19-profile.v1:sha256:" + "1".repeat(64),
      definition: { policy_id: "bpic19.all_raw_case_attributes.v1", roles: chosen.roles, profile_columns: [],
        category_labels: { after_gr: "3-way match, invoice after GR", before_gr: "3-way match, invoice before GR", two_way: "2-way match", consignment: "Consignment" },
        category_assignment: "supplied_exact_invariant_category", flag_policy: "bpic19.category_flags_and_consignment_type.v1", grain_policy: "bpic19.document_item_underscore.v1",
        ...(chosen.source_interpretation ? { source_interpretation: chosen.source_interpretation } : {}) },
      population: { case_count: 2, record_count: 3, document_count: 2, document_unknown_case_count: 0 },
      flows: [], unresolved: [], cross_checks: [], attributes: [], flow_item_types: [],
      partition: { classified_case_count: 0, unresolved_case_count: 2, is_disjoint: true, covers_parent: true },
      grain: { mixed_flow_document_count: 0, mixed_flow_document_examples: [], identity_issues: [] },
    },
  };
}

vi.mock("./Bpic19Profile", () => ({ Bpic19Profile: function ProfileBoundary(props: Bpic19ProfileProps) {
  const scope = JSON.stringify(props.identity);
  useEffect(() => {
    props.onValidityChange?.(false);
    return () => props.onValidityChange?.(false);
    // Model the analytical panel's request/cleanup validity for this specific population.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  return <section aria-label="Scripted source profile">
    <output data-testid="current-source-query">{JSON.stringify(props.query ?? null)}</output>
    <output data-testid="current-profile-population">{props.identity.population_id}</output>
    <button onClick={() => props.onColumns?.({ ...reviewedAnswer(props), profile: null, binding_state: "needs_review", query: { ...query, roles: null } })}>Inspect scripted columns</button>
    <button onClick={() => { props.onReviewed?.(reviewedAnswer(props)); props.onValidityChange?.(true); }}>Review scripted source</button>
    <button onClick={() => props.onValidityChange?.(false)}>Edit scripted source definition</button>
    <button onClick={() => {
      const answer = reviewedAnswer(props);
      if (!answer.profile) throw new Error("Missing reviewed profile");
      props.onKeep({ kind: "case_id_in", case_ids: ["A-1"], negate: false }, {
        definition_id: answer.profile.definition_id, definition: answer.profile.definition,
        source_identity: props.identity, query: answer.query, group: { kind: "source_inclusion" }, case_ids: ["A-1"],
      });
    }}>Keep scripted first item</button>
  </section>;
} }));
vi.mock("./Bpic19Measures", () => ({ Bpic19Measures: (props: Bpic19MeasuresProps) => <section aria-label="Scripted activity counts">
  <button onClick={() => {
    props.onReviewed?.(measuresAnswer({ schema_version: 1, message_type: "bpic19_measures_request", request_id: "count-first-fixture",
      query_revision: props.revision, workspace_id: props.workspaceId, identity: props.identity,
      query: { policy_id: "bpic19.source_witnessed_measures.v1", measure_profile: "paper_v1", roles: {}, offset: 0, limit: 20 } }));
    props.onValidityChange?.(true);
  }}>Review scripted activity counts</button>
</section> }));
vi.mock("./Bpic19SavedScore", () => ({ Bpic19SavedScore: function NativeDraft(props: Bpic19ScoringProps & {savedRunId?: string}) {
  useEffect(() => { props.onValidityChange?.(false); }, [props.onValidityChange]);
  return <section aria-label="Scripted current assessment">{props.savedRunId ?? "Unrequested current draft"}</section>;
} }));

const active: { stop(): void }[] = [];
afterEach(() => { for (const coordinator of active.splice(0)) coordinator.stop(); });
function fixture() {
  const imports = scriptedImportClient(), selecting = scriptedSelectionClient(), saves = scriptedSavingClient();
  const investigation = new ImportedInvestigationCoordinator(imports.client, selecting.client, scriptedViewClient().client);
  const comparison = new CompareCoordinator(scriptedComparisonClient().client);
  const session = new Bpic19Session();
  const saving = new SavingCoordinator(saves.client, investigation, undefined, undefined, session);
  active.push(investigation, comparison, saving);
  const props = { investigation, comparison, saving, session, active: true, onShowData: vi.fn(), onShowComparison: vi.fn() };
  return { imports, selecting, saves, investigation, comparison, session, saving, props };
}
type Fixture = ReturnType<typeof fixture>;
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
async function answerSelection(app: Fixture, index: number, figures: Figures) {
  await act(async () => {
    const selection = app.selecting.selections[index];
    selection.reply({ ok: true, answer: selectionAnswer(selection.request, figures) });
    await settle();
    const graph = app.selecting.graphs.find(call => call.request.query_revision === selection.request.query_revision);
    if (!graph) throw new Error("Selection must request its matching graph");
    graph.reply({ ok: true, answer: graphAnswer(graph.request, figures.kept.case_ids) });
    await settle();
  });
}
async function answerPopulation(app: Fixture, index: number) {
  await act(async () => {
    const population = app.imports.populations[index];
    population.reply({ ok: true, answer: populationAnswer(population.request) });
    await settle();
  });
  await answerSelection(app, index, everyIncident);
}
async function opening() {
  const app = fixture();
  app.investigation.open({ workspaceId, preparationId });
  await answerPopulation(app, 0);
  const view = render(<Bpic19Workspace {...app.props} />);
  return { ...app, ...view, user: userEvent.setup() };
}


describe("purchasing workspace coherence across real coordinator changes", () => {
  it("keeps restored source-parent assessments separate without opening an unrequested current-selection draft", async () => {
    const app = fixture(); app.investigation.open({workspaceId, preparationId});
    await act(async () => {
      app.imports.populations[0].reply({ok:true,answer:populationAnswer(app.imports.populations[0].request)}); await settle();
    });
    const state = app.investigation.getState();
    if (state.population.phase !== "ready") throw new Error("The source parent is ready while its selection is pending");
    const base = state.population.answer.identity;
    const selected = selectionAnswer(app.selecting.selections[0].request, everyIncident).identity;
    app.investigation.markSaved({investigationId: "investigation.v1:11111111111141118111111111111111", revisionId:firstRevisionId,
      content:{...savedContent,base_identity:base,selection_identity:selected,selection_recipe:{parent_case_ids:["A-1","B-2"],predicates:[]},comparison:null,
        bpic19_pipeline:{schema_version:1,actions:[{operation:"bpic19_score",identity:base,selection_prefix_length:null,query:{run_id:"frozen-source-parent"},definition_id:"frozen-definition"}]}}});
    render(<Bpic19Workspace {...app.props}/>);
    fireEvent.click(screen.getByRole("button",{name:"Review scripted source"}));
    expect(screen.queryByRole("region",{name:"Scripted current assessment"})).toBeNull();
    await answerSelection(app,0,everyIncident);
    const user=userEvent.setup(); await user.click(screen.getByRole("button",{name:"Review scripted source"}));
    await user.click(screen.getByRole("button",{name:"Review scripted activity counts"}));
    expect(base.population_id).not.toBe(selected.population_id);
    expect(screen.queryByRole("region",{name:"Scripted current assessment"})).toBeNull();
    expect(screen.getByRole("button",{name:"Evaluate purchasing criteria and priorities"})).toBeTruthy();
    expect(app.session.readyForSave()).toBe(true);
    expect(app.session.savedPipeline()?.actions).toEqual(expect.arrayContaining([expect.objectContaining({operation:"bpic19_score",identity:base})]));
  });
  it("reviews and saves recorded counts before the purchasing flow roles are accepted", async () => {
    const app = await opening();
    expect(screen.queryByRole("region", { name: "Scripted activity counts" })).toBeNull();
    await app.user.click(screen.getByRole("button", { name: "Inspect scripted columns" }));
    await app.user.click(screen.getByRole("button", { name: "Review scripted activity counts" }));
    expect(app.session.readyForSave()).toBe(true);
    expect(app.session.savedPipeline()?.actions.map(action => action.operation)).toEqual(["bpic19_measures"]);
    await act(async () => { app.saving.save("Recorded counts before flow review", "Count all recorded activities", "incidents"); await settle(); });
    expect(app.saves.saves).toHaveLength(1);
    expect(app.saves.saves[0].request.bpic19_pipeline?.actions.map(action => action.operation)).toEqual(["bpic19_measures"]);
    expect(JSON.parse(screen.getByTestId("current-source-query").textContent ?? "null")).toBeNull();
  });
  it("keeps the latest reviewed source, horizon and role query when Keep changes the population identity", async () => {
    const app = await opening();
    await app.user.click(screen.getByRole("button", { name: "Review scripted source" }));
    expect(JSON.parse(screen.getByTestId("current-source-query").textContent ?? "null")).toEqual(query);
    const parentIdentity = shownSelection(app.investigation.getState().selection)?.answer.identity;
    await app.user.click(screen.getByRole("button", { name: "Keep scripted first item" }));
    expect(app.selecting.selections[1].request.predicates).toEqual([{ kind: "case_id_in", case_ids: ["A-1"], negate: false }]);
    await answerSelection(app, 1, containingOpened);
    const child = shownSelection(app.investigation.getState().selection);
    expect(child?.answer.kept).toEqual({ case_ids: ["A-1"], case_count: 1, record_count: 2 });
    expect(child?.answer.identity.population_id).not.toBe(parentIdentity?.population_id);
    expect(screen.getByTestId("current-profile-population").textContent).toBe(child?.answer.identity.population_id);
    expect(JSON.parse(screen.getByTestId("current-source-query").textContent ?? "null")).toEqual(query);
    // A new identity needs a matching answer before that action enters the saved pipeline.
    expect(app.session.savedPipeline()).toBeNull();
    await app.user.click(screen.getByRole("button", { name: "Review scripted source" }));
    expect(app.session.savedPipeline()?.actions.at(-1)).toMatchObject({ identity: child?.answer.identity, query });
  });

  it("removes current export and blocks save after the displayed source definition becomes dirty", async () => {
    const app = await opening();
    await app.user.click(screen.getByRole("button", { name: "Review scripted source" }));
    await act(async () => { app.saving.save("Current source review", "Synthetic source policy", "incidents"); await settle(); });
    const call = app.saves.saves[0];
    expect(call.request.bpic19_pipeline?.actions[0].query).toEqual(query);
    const answer = saveAnswer(call.request, firstRevisionId, true);
    answer.revision.content.bpic19_pipeline = call.request.bpic19_pipeline;
    answer.bpic19_outputs = { schema_version: 1, outputs: [{ operation: "bpic19_profile", definition_id: "bpic19-profile.v1:sha256:" + "1".repeat(64), sha256: "a".repeat(64), output: { synthetic_test: "current source answer" } }] };
    await act(async () => { call.reply({ ok: true, answer }); await settle(); });
    expect(await screen.findByRole("button", { name: "Export saved definitions, results and witnesses" })).toBeTruthy();
    await app.user.click(screen.getByRole("button", { name: "Edit scripted source definition" }));
    expect(app.session.readyForSave()).toBe(false);
    expect(screen.queryByRole("button", { name: "Export saved definitions, results and witnesses" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Save$/ }).hasAttribute("disabled")).toBe(true);
    expect(app.saving.draft(app.investigation.getState())).toMatchObject({ ready: false });
    app.saving.save("Unreviewed changed source", "Must not publish", "incidents");
    expect(app.saves.saves).toHaveLength(1);
  });

  it("disengages a hidden purchasing panel for a new generic preparation so its investigation can save", async () => {
    const app = await opening();
    await app.user.click(screen.getByRole("button", { name: "Review scripted source" }));
    await app.user.click(screen.getByRole("button", { name: "Edit scripted source definition" }));
    expect(app.session.readyForSave()).toBe(false);
    app.rerender(<Bpic19Workspace {...app.props} active={false} />);
    await act(async () => { app.investigation.open({ workspaceId, preparationId: earlierPreparationId }); await settle(); });
    await answerPopulation(app, 1);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Scripted source profile" })).toBeNull());
    expect(app.session.readyForSave()).toBe(true);
    expect(app.session.savedPipeline()).toBeNull();
    expect(app.saving.draft(app.investigation.getState())).toMatchObject({ ready: true });
    app.saving.save("Generic incident investigation", "No purchasing interpretation", "incidents");
    expect(app.saves.saves).toHaveLength(1);
    expect(app.saves.saves[0].request.base_identity.preparation_id).toBe(earlierPreparationId);
    expect(app.saves.saves[0].request.bpic19_pipeline).toBeUndefined();
  });
});
