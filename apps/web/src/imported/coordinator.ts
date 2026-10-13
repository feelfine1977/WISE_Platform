import type {
  CaseId,
  ImportedCaseEvidenceAnswer,
  ImportedCaseEvidenceRequest,
  ImportedPopulationAnswer,
  OpenPopulationRequest,
  PreparationId,
  WorkspaceId,
} from "../generated/imports";
import type { ImportClient, ImportOutcome, ImportProblem } from "../data/client";
import { sameJson } from "../data/coordinator";
import type {
  ProcessGraphAnswer,
  ProcessGraphRequest,
  SelectCasesRequest,
  SelectionAnswer,
  SelectionPredicate,
  SuppliedGraph,
} from "../generated/selection";
import type { SelectionClient, SelectionOutcome, SelectionProblem } from "../map/client";
import { noSteps, redone, type StepHistory, type Steps, undone, withoutStep, withoutSteps, withStep } from "../map/steps";

/** The preparation an imported investigation is opened on. */
export interface PreparationTarget {
  workspaceId: WorkspaceId;
  preparationId: PreparationId;
}

export type ImportedPopulationState =
  | { phase: "idle" }
  | { phase: "loading"; revision: number; target: PreparationTarget }
  | { phase: "ready"; revision: number; target: PreparationTarget; answer: ImportedPopulationAnswer }
  | { phase: "failed"; revision: number; target: PreparationTarget; problem: ImportProblem };

export type ImportedCaseState =
  | { phase: "closed" }
  | { phase: "loading"; caseId: CaseId }
  | { phase: "ready"; caseId: CaseId; answer: ImportedCaseEvidenceAnswer }
  | { phase: "failed"; caseId: CaseId; problem: ImportProblem };

/** A selection the local service answered together with the map of exactly its kept incidents. */
export interface ShownSelection {
  /** The query revision the selection and its map were answered under. */
  revision: number;
  steps: Steps;
  answer: SelectionAnswer;
  graph: SuppliedGraph;
}

/**
 * The selection of whole incidents of the population. `history` holds the steps asked for now;
 * `shown` is the last selection answered with its map, which stays visible, marked as pending or
 * failed, until the steps asked for now are answered.
 */
export type ImportedSelectionState =
  | { phase: "idle" }
  | { phase: "loading"; revision: number; history: StepHistory; shown: ShownSelection | null }
  | { phase: "ready"; revision: number; history: StepHistory; shown: ShownSelection }
  | { phase: "failed"; revision: number; history: StepHistory; shown: ShownSelection | null; problem: SelectionProblem };

export interface ImportedInvestigationState {
  population: ImportedPopulationState;
  inspected: ImportedCaseState;
  selection: ImportedSelectionState;
  /** The map of every incident of the parent, from which the map's arrangement is computed once. */
  parentGraph: SuppliedGraph | null;
}

/** The selection whose answer is shown, if one is. */
export function shownSelection(selection: ImportedSelectionState): ShownSelection | null {
  return selection.phase === "idle" ? null : selection.shown;
}

const unreachable: ImportOutcome<never> = { ok: false, problem: { kind: "unreachable" } };
const selectionUnreachable: SelectionOutcome<never> = { ok: false, problem: { kind: "unreachable" } };

function mismatch(detail: string): ImportOutcome<never> & SelectionOutcome<never> {
  return { ok: false, problem: { kind: "unsupported_reply", detail } };
}

const initialState: ImportedInvestigationState = {
  population: { phase: "idle" },
  inspected: { phase: "closed" },
  selection: { phase: "idle" },
  parentGraph: null,
};

/**
 * Holds the query revision of the investigation of one imported preparation and is the only place
 * where its replies are published: the population, the selection of its incidents with the map of
 * the kept ones, and the complete history of one kept incident. Opening the population and every
 * change of the selection start a new revision. A reply whose revision or request is no longer
 * current is dropped, whether it is an answer, a refusal or a failure.
 */
export class ImportedInvestigationCoordinator {
  private state: ImportedInvestigationState = initialState;
  private revision = 0;
  private caseRequestSequence = 0;
  private currentCaseRequestId: string | null = null;
  private populationRequest: AbortController | null = null;
  private caseRequest: AbortController | null = null;
  private selectionRequest: AbortController | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly client: ImportClient,
    private readonly selectionClient: SelectionClient,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): ImportedInvestigationState => this.state;

  open(target: PreparationTarget): void {
    this.revision += 1;
    const revision = this.revision;
    this.populationRequest?.abort();
    this.cancelSelectionRequest();
    this.cancelCaseRequest();
    const request: OpenPopulationRequest = {
      schema_version: 1,
      message_type: "open_population_request",
      request_id: `population-${revision}`,
      query_revision: revision,
      workspace_id: target.workspaceId,
      preparation_id: target.preparationId,
    };
    this.publish({ ...initialState, population: { phase: "loading", revision, target } });
    const controller = new AbortController();
    this.populationRequest = controller;
    this.client.openPopulation(request, controller.signal).then(
      (outcome) => this.receivePopulation(request, target, outcome),
      () => this.receivePopulation(request, target, unreachable),
    );
  }

  retryPopulation(): void {
    const population = this.state.population;
    if (population.phase === "failed") this.open(population.target);
  }

  /** Opens the complete history of an incident of the selection shown, or of the population before one is. */
  openCase(caseId: CaseId): void {
    const population = this.state.population;
    if (population.phase !== "ready") return;
    this.cancelCaseRequest();
    this.caseRequestSequence += 1;
    const shown = shownSelection(this.state.selection);
    const request: ImportedCaseEvidenceRequest = {
      schema_version: 1,
      message_type: "imported_case_evidence_request",
      request_id: `case-${this.revision}-${this.caseRequestSequence}`,
      query_revision: this.revision,
      workspace_id: population.answer.workspace_id,
      identity: shown ? shown.answer.identity : population.answer.identity,
      case_id: caseId,
    };
    this.currentCaseRequestId = request.request_id;
    this.publish({ ...this.state, inspected: { phase: "loading", caseId } });
    const controller = new AbortController();
    this.caseRequest = controller;
    this.client.caseEvidence(request, controller.signal).then(
      (outcome) => this.receiveCase(request, outcome),
      () => this.receiveCase(request, unreachable),
    );
  }

  retryCase(): void {
    if (this.state.inspected.phase === "failed") this.openCase(this.state.inspected.caseId);
  }

  closeCase(): void {
    this.cancelCaseRequest();
    if (this.state.inspected.phase !== "closed") this.publish({ ...this.state, inspected: { phase: "closed" } });
  }

  /** Keeps, in addition, the incidents that satisfy a step. */
  addStep(step: SelectionPredicate): void {
    this.changeSteps((history) => withStep(history, step));
  }

  removeStep(step: SelectionPredicate): void {
    this.changeSteps((history) => withoutStep(history, step));
  }

  clearSteps(): void {
    this.changeSteps(withoutSteps);
  }

  undo(): void {
    this.changeSteps(undone);
  }

  redo(): void {
    this.changeSteps(redone);
  }

  retrySelection(): void {
    const selection = this.state.selection;
    if (selection.phase === "failed") this.select(selection.history);
  }

  /** Abandons every outstanding request; replies to them are dropped when they arrive. */
  stop(): void {
    this.revision += 1;
    this.populationRequest?.abort();
    this.populationRequest = null;
    this.cancelSelectionRequest();
    this.cancelCaseRequest();
  }

  private changeSteps(change: (history: StepHistory) => StepHistory): void {
    const selection = this.state.selection;
    if (selection.phase === "idle") return;
    const history = change(selection.history);
    if (history !== selection.history) this.select(history);
  }

  /** Asks for the incidents the steps keep and then for the map of exactly those, under one new revision. */
  private select(history: StepHistory): void {
    const population = this.state.population;
    if (population.phase !== "ready") return;
    this.revision += 1;
    const revision = this.revision;
    this.cancelSelectionRequest();
    // A history asked for under the earlier selection is asked for again once this one is answered.
    this.cancelCaseRequest();
    const request: SelectCasesRequest = {
      schema_version: 1,
      message_type: "select_cases_request",
      request_id: `select-${revision}`,
      query_revision: revision,
      workspace_id: population.answer.workspace_id,
      identity: population.answer.identity,
      parent_case_ids: null,
      predicates: [...history.present],
    };
    this.publish({ ...this.state, selection: { phase: "loading", revision, history, shown: shownSelection(this.state.selection) } });
    const controller = new AbortController();
    this.selectionRequest = controller;
    this.selectionClient.selectCases(request, controller.signal).then(
      (outcome) => this.receiveSelection(request, history, population.answer, outcome, controller),
      () => this.receiveSelection(request, history, population.answer, selectionUnreachable, controller),
    );
  }

  private receiveSelection(
    request: SelectCasesRequest,
    history: StepHistory,
    population: ImportedPopulationAnswer,
    outcome: SelectionOutcome<SelectionAnswer>,
    controller: AbortController,
  ): void {
    if (request.query_revision !== this.revision) return;
    const checked = outcome.ok ? checkSelection(request, population, outcome.answer) : checkSelectionProblem(request, outcome.problem);
    if (!checked.ok) {
      this.failSelection(request.query_revision, history, checked.problem);
      return;
    }
    const answer = checked.answer;
    const graphRequest: ProcessGraphRequest = {
      schema_version: 1,
      message_type: "process_graph_request",
      request_id: `graph-${request.query_revision}`,
      query_revision: request.query_revision,
      workspace_id: request.workspace_id,
      identity: answer.identity,
    };
    this.selectionClient.processGraph(graphRequest, controller.signal).then(
      (graphOutcome) => this.receiveGraph(graphRequest, history, answer, graphOutcome),
      () => this.receiveGraph(graphRequest, history, answer, selectionUnreachable),
    );
  }

  private receiveGraph(
    request: ProcessGraphRequest,
    history: StepHistory,
    selected: SelectionAnswer,
    outcome: SelectionOutcome<ProcessGraphAnswer>,
  ): void {
    if (request.query_revision !== this.revision) return;
    this.selectionRequest = null;
    const checked = outcome.ok ? checkGraph(request, selected, outcome.answer) : checkSelectionProblem(request, outcome.problem);
    if (!checked.ok) {
      this.failSelection(request.query_revision, history, checked.problem);
      return;
    }
    const graph = checked.answer.graph;
    this.publish({
      ...this.state,
      selection: { phase: "ready", revision: request.query_revision, history, shown: { revision: request.query_revision, steps: history.present, answer: selected, graph } },
      // Without steps every incident of the parent is kept: this is the map of the whole parent.
      parentGraph: this.state.parentGraph ?? (history.present.length === 0 ? graph : null),
    });
    this.followSelection(selected);
  }

  private failSelection(revision: number, history: StepHistory, problem: SelectionProblem): void {
    this.selectionRequest = null;
    const shown = shownSelection(this.state.selection);
    this.publish({ ...this.state, selection: { phase: "failed", revision, history, shown, problem } });
    // A history whose request the selection abandoned is asked for again under the selection still shown.
    const inspected = this.state.inspected;
    if (inspected.phase === "loading" && this.currentCaseRequestId === null) this.openCase(inspected.caseId);
  }

  /** The inspector shows the complete history of a kept incident under the new selection, or closes. */
  private followSelection(selected: SelectionAnswer): void {
    const inspected = this.state.inspected;
    if (inspected.phase === "closed") return;
    if (selected.kept.case_ids.includes(inspected.caseId)) this.openCase(inspected.caseId);
    else this.publish({ ...this.state, inspected: { phase: "closed" } });
  }

  private cancelSelectionRequest(): void {
    this.selectionRequest?.abort();
    this.selectionRequest = null;
  }

  private receivePopulation(
    request: OpenPopulationRequest,
    target: PreparationTarget,
    outcome: ImportOutcome<ImportedPopulationAnswer>,
  ): void {
    if (request.query_revision !== this.revision) return;
    this.populationRequest = null;
    const revision = request.query_revision;
    const checked = outcome.ok ? checkPopulation(request, outcome.answer) : checkProblem(request, outcome.problem);
    if (!checked.ok) {
      this.publish({ ...initialState, population: { phase: "failed", revision, target, problem: checked.problem } });
      return;
    }
    this.publish({ ...initialState, population: { phase: "ready", revision, target, answer: checked.answer } });
    this.select(noSteps);
  }

  private receiveCase(request: ImportedCaseEvidenceRequest, outcome: ImportOutcome<ImportedCaseEvidenceAnswer>): void {
    if (request.query_revision !== this.revision || request.request_id !== this.currentCaseRequestId) return;
    this.caseRequest = null;
    this.currentCaseRequestId = null;
    const caseId = request.case_id;
    const checked = outcome.ok ? checkCase(request, outcome.answer) : checkProblem(request, outcome.problem);
    this.publish({
      ...this.state,
      inspected: checked.ok ? { phase: "ready", caseId, answer: checked.answer } : { phase: "failed", caseId, problem: checked.problem },
    });
  }

  private cancelCaseRequest(): void {
    this.caseRequest?.abort();
    this.caseRequest = null;
    this.currentCaseRequestId = null;
  }

  private publish(state: ImportedInvestigationState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

/** A refusal that names another request or revision does not answer this one. */
function checkProblem(request: OpenPopulationRequest | ImportedCaseEvidenceRequest, problem: ImportProblem): ImportOutcome<never> {
  if (problem.kind === "refusal") {
    const { request_id, query_revision } = problem.refusal;
    if ((request_id !== null && request_id !== request.request_id) || (query_revision !== null && query_revision !== request.query_revision)) {
      return mismatch("The refusal names a different request or query revision.");
    }
  }
  return { ok: false, problem };
}

function checkPopulation(request: OpenPopulationRequest, answer: ImportedPopulationAnswer): ImportOutcome<ImportedPopulationAnswer> {
  if (answer.request_id !== request.request_id || answer.query_revision !== request.query_revision) {
    return mismatch("The reply names a different request or query revision.");
  }
  if (answer.workspace_id !== request.workspace_id) return mismatch("The reply belongs to a different workspace.");
  if (answer.identity.preparation_id !== request.preparation_id || answer.preparation.preparation_id !== request.preparation_id) {
    return mismatch("The reply describes a different preparation.");
  }
  return { ok: true, answer };
}

function checkCase(request: ImportedCaseEvidenceRequest, answer: ImportedCaseEvidenceAnswer): ImportOutcome<ImportedCaseEvidenceAnswer> {
  if (answer.request_id !== request.request_id || answer.query_revision !== request.query_revision) {
    return mismatch("The reply names a different request or query revision.");
  }
  if (answer.case_id !== request.case_id) return mismatch("The reply describes a different incident.");
  if (!sameJson(answer.identity, request.identity)) return mismatch("The reply belongs to a different population identity.");
  return { ok: true, answer };
}

/** A refusal that names another request or revision does not answer this one. */
function checkSelectionProblem(request: SelectCasesRequest | ProcessGraphRequest, problem: SelectionProblem): SelectionOutcome<never> {
  if (problem.kind === "refusal") {
    const { request_id, query_revision } = problem.refusal;
    if ((request_id !== null && request_id !== request.request_id) || (query_revision !== null && query_revision !== request.query_revision)) {
      return mismatch("The refusal names a different request or query revision.");
    }
  }
  return { ok: false, problem };
}

const boundFields = ["source_id", "preparation_id", "representation_id", "case_dictionary_id", "implementation_version"] as const;

function checkSelection(
  request: SelectCasesRequest,
  population: ImportedPopulationAnswer,
  answer: SelectionAnswer,
): SelectionOutcome<SelectionAnswer> {
  if (answer.request_id !== request.request_id || answer.query_revision !== request.query_revision) {
    return mismatch("The reply names a different request or query revision.");
  }
  if (answer.workspace_id !== request.workspace_id) return mismatch("The reply belongs to a different workspace.");
  if (boundFields.some((field) => answer.identity[field] !== request.identity[field] || answer.parent_identity[field] !== request.identity[field])) {
    return mismatch("The reply describes a different preparation.");
  }
  if (!sameJson(answer.predicate_results.map((result) => result.predicate), request.predicates)) {
    return mismatch("The reply answers different steps.");
  }
  if (!sameJson(answer.parent.case_ids, population.population.case_ids)) {
    return mismatch("The reply selects from a different population.");
  }
  return { ok: true, answer };
}

function checkGraph(request: ProcessGraphRequest, selected: SelectionAnswer, answer: ProcessGraphAnswer): SelectionOutcome<ProcessGraphAnswer> {
  if (answer.request_id !== request.request_id || answer.query_revision !== request.query_revision) {
    return mismatch("The reply names a different request or query revision.");
  }
  if (answer.workspace_id !== request.workspace_id) return mismatch("The reply belongs to a different workspace.");
  if (!sameJson(answer.identity, request.identity)) return mismatch("The map belongs to a different population identity.");
  if (!sameJson(answer.graph.meta.selected_case_ids, selected.kept.case_ids)) return mismatch("The map is of different incidents than the selection.");
  return { ok: true, answer };
}
