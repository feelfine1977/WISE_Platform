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
  AnswerIdentity,
  ProcessGraphAnswer,
  ProcessGraphRequest,
  SelectCasesRequest,
  SelectionAnswer,
  SelectionPredicate,
  SuppliedGraph,
} from "../generated/selection";
import type { SavedInvestigationContent } from "../generated/saving";
import type { SelectionClient, SelectionOutcome, SelectionProblem } from "../map/client";
import { noSteps, redone, type StepHistory, type Steps, undone, withoutStep, withoutSteps, withStep } from "../map/steps";
import { httpPopulationViewClient, type PopulationViewClient, type ViewOutcome, type ViewProblem } from "../views/client";
import type { OpeningContextAnswer, OpeningContextRequest, VariantId, VariantsAnswer, VariantsRequest } from "../views/messages";

/** The preparation an imported investigation is opened on. */
export interface PreparationTarget {
  workspaceId: WorkspaceId;
  preparationId: PreparationId;
}

/** The view an investigation shows its kept incidents in. */
export type InvestigationView = "incidents" | "map";

/** The saved investigation the question shown belongs to: its latest revision known here and what it holds. */
export interface SavedBinding {
  investigationId: string;
  revisionId: string;
  content: SavedInvestigationContent;
}

/** A saved question to open again: its preparation, its steps on their parent, and what reopening it answered. */
export interface Restoration {
  target: PreparationTarget;
  steps: Steps;
  parentCaseIds: CaseId[];
  /** The identity of the selection the local service restored; the steps asked for must give it again. */
  selectionIdentity: AnswerIdentity;
  binding: SavedBinding;
  view: InvestigationView;
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

/** An answer about the shown selection that is requested once the selection and its map are answered. */
export type ViewState<Answer> =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; answer: Answer }
  | { phase: "failed"; problem: ViewProblem };

/** The population whose views are asked for: the parent, or a selection of it. */
type ViewTarget = Pick<ImportedPopulationAnswer, "workspace_id" | "identity">;

/** One outstanding request for a view of the selection, and how to abandon it. */
interface Pending {
  requestId: string;
  controller: AbortController;
}

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
  openingContext: ViewState<OpeningContextAnswer>;
  variants: ViewState<VariantsAnswer>;
  /** The variant whose incidents the table lists until the choice is cleared; a view, not a selection step. */
  chosenVariant: VariantId | null;
  /** The map of every incident of the parent, from which the map's arrangement is computed once. */
  parentGraph: SuppliedGraph | null;
  /** The saved investigation this question was reopened from or saved as; null until it is saved. */
  saved: SavedBinding | null;
  /** The view a reopened investigation was saved in; null for a question opened from the Data area. */
  restoredView: InvestigationView | null;
  /** The incidents the selection is made of: every incident of the population (null), or the saved parent. */
  parentCaseIds: CaseId[] | null;
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
  openingContext: { phase: "idle" },
  variants: { phase: "idle" },
  chosenVariant: null,
  parentGraph: null,
  saved: null,
  restoredView: null,
  parentCaseIds: null,
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
  private viewRequestSequence = 0;
  private currentCaseRequestId: string | null = null;
  private populationRequest: AbortController | null = null;
  private caseRequest: AbortController | null = null;
  private selectionRequest: AbortController | null = null;
  private viewTarget: ViewTarget | null = null;
  /** The query revision the views of the target were first asked under; a retry asks under it again. */
  private viewRevision = 0;
  private openingRequest: Pending | null = null;
  private variantsRequest: Pending | null = null;
  /** The steps the population is selected by once it is open; a reopened investigation's saved steps. */
  private openingSteps: Steps = [];
  /** The identity the first selection of a reopened investigation must have, until it is answered. */
  private restoredIdentity: AnswerIdentity | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly client: ImportClient,
    private readonly selectionClient: SelectionClient,
    private readonly views: PopulationViewClient = httpPopulationViewClient,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): ImportedInvestigationState => this.state;

  open(target: PreparationTarget): void {
    this.openWith(target, null);
  }

  /**
   * Opens a reopened investigation: its population, then its saved steps on its saved parent, with
   * an undo history that starts with them. The selection answered must have the restored identity;
   * otherwise it is shown as a failure, never as the saved state.
   */
  restore(restoration: Restoration): void {
    this.openWith(restoration.target, restoration);
  }

  /** Records the revision the question was saved as. */
  markSaved(binding: SavedBinding): void {
    this.publish({ ...this.state, saved: binding });
  }

  private openWith(target: PreparationTarget, restoration: Restoration | null): void {
    this.revision += 1;
    const revision = this.revision;
    this.populationRequest?.abort();
    this.cancelSelectionRequest();
    this.cancelCaseRequest();
    this.cancelViewRequests();
    const request: OpenPopulationRequest = {
      schema_version: 1,
      message_type: "open_population_request",
      request_id: `population-${revision}`,
      query_revision: revision,
      workspace_id: target.workspaceId,
      preparation_id: target.preparationId,
    };
    this.openingSteps = restoration ? restoration.steps : [];
    this.restoredIdentity = restoration ? restoration.selectionIdentity : null;
    const opening = {
      saved: restoration ? restoration.binding : null,
      restoredView: restoration ? restoration.view : null,
      parentCaseIds: restoration ? restoration.parentCaseIds : null,
    };
    this.publish({ ...initialState, ...opening, population: { phase: "loading", revision, target } });
    const controller = new AbortController();
    this.populationRequest = controller;
    this.client.openPopulation(request, controller.signal).then(
      (outcome) => this.receivePopulation(request, target, outcome),
      () => this.receivePopulation(request, target, unreachable),
    );
  }

  retryPopulation(): void {
    const { population, saved, restoredView, parentCaseIds } = this.state;
    if (population.phase !== "failed") return;
    if (saved === null || parentCaseIds === null || this.restoredIdentity === null) {
      this.open(population.target);
      return;
    }
    const steps = this.openingSteps;
    this.restore({ target: population.target, steps, parentCaseIds, selectionIdentity: this.restoredIdentity, binding: saved, view: restoredView ?? "incidents" });
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

  retryOpeningContext(): void {
    if (this.viewTarget && this.state.openingContext.phase === "failed") this.requestOpeningContext(this.viewTarget);
  }

  retryVariants(): void {
    if (this.viewTarget && this.state.variants.phase === "failed") this.requestVariants(this.viewTarget);
  }

  /** Lists the incidents of one variant of the current answer in the table; the selection stays as it is. */
  chooseVariant(variantId: VariantId): void {
    const variants = this.state.variants;
    if (variants.phase !== "ready" || !variants.answer.variants.variants.some((variant) => variant.id === variantId)) return;
    if (this.state.chosenVariant !== variantId) this.publish({ ...this.state, chosenVariant: variantId });
  }

  clearVariant(): void {
    if (this.state.chosenVariant !== null) this.publish({ ...this.state, chosenVariant: null });
  }

  /** Abandons every outstanding request; replies to them are dropped when they arrive. */
  stop(): void {
    this.revision += 1;
    this.populationRequest?.abort();
    this.populationRequest = null;
    this.cancelSelectionRequest();
    this.cancelCaseRequest();
    this.cancelViewRequests();
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
      parent_case_ids: this.state.parentCaseIds === null ? null : [...this.state.parentCaseIds],
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
    const restored = this.restoredIdentity;
    this.restoredIdentity = null;
    let checked = outcome.ok ? checkSelection(request, population, outcome.answer) : checkSelectionProblem(request, outcome.problem);
    if (checked.ok && restored !== null && !sameJson(checked.answer.identity, restored)) {
      checked = mismatch("The incidents selected now are not those of the saved investigation.");
    }
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
    // The views follow the selection shown; the population's own views stand for a selection with the same identity.
    if (!sameJson(selected.identity, this.viewTarget?.identity)) this.requestViews(selected);
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
      this.publish({ ...this.state, population: { phase: "failed", revision, target, problem: checked.problem } });
      return;
    }
    this.publish({ ...this.state, population: { phase: "ready", revision, target, answer: checked.answer } });
    this.requestViews(checked.answer);
    this.select(this.openingSteps.length === 0 ? noSteps : { past: [], present: this.openingSteps, future: [] });
  }

  private viewRequest<Kind extends "opening_context_request" | "variants_request">(messageType: Kind, target: ViewTarget) {
    this.viewRequestSequence += 1;
    const prefix = messageType === "opening_context_request" ? "opening" : "variants";
    return {
      schema_version: 1 as const,
      message_type: messageType,
      request_id: `${prefix}-${this.viewRevision}-${this.viewRequestSequence}`,
      query_revision: this.viewRevision,
      workspace_id: target.workspace_id,
      identity: target.identity,
    };
  }

  private requestViews(target: ViewTarget): void {
    this.viewTarget = target;
    this.viewRevision = this.revision;
    this.requestOpeningContext(target);
    this.requestVariants(target);
  }

  private requestOpeningContext(target: ViewTarget): void {
    this.openingRequest?.controller.abort();
    const request: OpeningContextRequest = this.viewRequest("opening_context_request", target);
    const pending = { requestId: request.request_id, controller: new AbortController() };
    this.openingRequest = pending;
    this.publish({ ...this.state, openingContext: { phase: "loading" } });
    this.views.openingContext(request, pending.controller.signal).then(
      (outcome) => this.receiveOpeningContext(request, outcome),
      () => this.receiveOpeningContext(request, viewUnreachable),
    );
  }

  private requestVariants(target: ViewTarget): void {
    this.variantsRequest?.controller.abort();
    const request: VariantsRequest = this.viewRequest("variants_request", target);
    const pending = { requestId: request.request_id, controller: new AbortController() };
    this.variantsRequest = pending;
    this.publish({ ...this.state, variants: { phase: "loading" }, chosenVariant: null });
    this.views.variants(request, pending.controller.signal).then(
      (outcome) => this.receiveVariants(request, outcome),
      () => this.receiveVariants(request, viewUnreachable),
    );
  }

  private receiveOpeningContext(request: OpeningContextRequest, outcome: ViewOutcome<OpeningContextAnswer>): void {
    if (request.request_id !== this.openingRequest?.requestId) return;
    this.openingRequest = null;
    const checked = outcome.ok ? checkView(request, outcome.answer) : checkViewProblem(request, outcome.problem);
    this.publish({ ...this.state, openingContext: checked.ok ? { phase: "ready", answer: checked.answer } : { phase: "failed", problem: checked.problem } });
  }

  private receiveVariants(request: VariantsRequest, outcome: ViewOutcome<VariantsAnswer>): void {
    if (request.request_id !== this.variantsRequest?.requestId) return;
    this.variantsRequest = null;
    const checked = outcome.ok ? checkView(request, outcome.answer) : checkViewProblem(request, outcome.problem);
    this.publish({ ...this.state, variants: checked.ok ? { phase: "ready", answer: checked.answer } : { phase: "failed", problem: checked.problem } });
  }

  private cancelViewRequests(): void {
    this.openingRequest?.controller.abort();
    this.variantsRequest?.controller.abort();
    this.openingRequest = null;
    this.variantsRequest = null;
    this.viewTarget = null;
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

const viewUnreachable: ViewOutcome<never> = { ok: false, problem: { kind: "unreachable" } };

function viewMismatch(detail: string): ViewOutcome<never> {
  return { ok: false, problem: { kind: "unsupported_reply", detail } };
}

interface ViewRequest {
  request_id: string;
  query_revision: number;
  workspace_id: string;
  identity: AnswerIdentity;
}

/** An answer about another request, workspace or population does not answer this one. */
function checkView<Answer extends ViewRequest>(request: ViewRequest, answer: Answer): ViewOutcome<Answer> {
  if (answer.request_id !== request.request_id || answer.query_revision !== request.query_revision) {
    return viewMismatch("The reply names a different request or query revision.");
  }
  if (answer.workspace_id !== request.workspace_id) return viewMismatch("The reply belongs to a different workspace.");
  if (!sameJson(answer.identity, request.identity)) return viewMismatch("The reply belongs to a different population identity.");
  return { ok: true, answer };
}

function checkViewProblem(request: ViewRequest, problem: ViewProblem): ViewOutcome<never> {
  if (problem.kind === "refusal") {
    const { request_id, query_revision } = problem.refusal;
    if ((request_id !== null && request_id !== request.request_id) || (query_revision !== null && query_revision !== request.query_revision)) {
      return viewMismatch("The refusal names a different request or query revision.");
    }
  }
  return { ok: false, problem };
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
  if (!sameParent(answer.parent.case_ids, request.parent_case_ids, population.population.case_ids)) {
    return mismatch("The reply selects from a different population.");
  }
  return { ok: true, answer };
}

/** Whether a selection was made of the parent asked for: every incident of the population, or the saved parent. */
function sameParent(answered: readonly CaseId[], asked: readonly CaseId[] | null, population: readonly CaseId[]): boolean {
  if (asked === null) return sameJson(answered, population);
  const expected = new Set(asked);
  return answered.length === expected.size && answered.every((caseId) => expected.has(caseId));
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
