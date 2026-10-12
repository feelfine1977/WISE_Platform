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
import type { AnswerIdentity } from "../generated/selection";
import { httpPopulationViewClient, type PopulationViewClient, type ViewOutcome, type ViewProblem } from "../views/client";
import type { OpeningContextAnswer, OpeningContextRequest, VariantId, VariantsAnswer, VariantsRequest } from "../views/messages";

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

/** An answer about the current population that is requested once the population is open. */
export type ViewState<Answer> =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; answer: Answer }
  | { phase: "failed"; problem: ViewProblem };

export interface ImportedInvestigationState {
  population: ImportedPopulationState;
  inspected: ImportedCaseState;
  openingContext: ViewState<OpeningContextAnswer>;
  variants: ViewState<VariantsAnswer>;
  /** The variant whose incidents the table lists until the choice is cleared; a view, not a selection step. */
  chosenVariant: VariantId | null;
}

const noViews = { openingContext: { phase: "idle" }, variants: { phase: "idle" }, chosenVariant: null } as const;

/** One outstanding request for a view of the population, and how to abandon it. */
interface Pending {
  requestId: string;
  controller: AbortController;
}

const unreachable: ImportOutcome<never> = { ok: false, problem: { kind: "unreachable" } };

function mismatch(detail: string): ImportOutcome<never> {
  return { ok: false, problem: { kind: "unsupported_reply", detail } };
}

/**
 * Holds the query revision of the investigation of one imported preparation and is the only place
 * where its replies are published. A reply whose revision or request is no longer current is
 * dropped, whether it is an answer, a refusal or a failure.
 */
export class ImportedInvestigationCoordinator {
  private state: ImportedInvestigationState = { population: { phase: "idle" }, inspected: { phase: "closed" }, ...noViews };
  private revision = 0;
  private caseRequestSequence = 0;
  private viewRequestSequence = 0;
  private currentCaseRequestId: string | null = null;
  private populationRequest: AbortController | null = null;
  private caseRequest: AbortController | null = null;
  private openingRequest: Pending | null = null;
  private variantsRequest: Pending | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly client: ImportClient,
    private readonly views: PopulationViewClient = httpPopulationViewClient,
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
    this.publish({ population: { phase: "loading", revision, target }, inspected: { phase: "closed" }, ...noViews });
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

  openCase(caseId: CaseId): void {
    const population = this.state.population;
    if (population.phase !== "ready") return;
    this.cancelCaseRequest();
    this.caseRequestSequence += 1;
    const request: ImportedCaseEvidenceRequest = {
      schema_version: 1,
      message_type: "imported_case_evidence_request",
      request_id: `case-${population.revision}-${this.caseRequestSequence}`,
      query_revision: population.revision,
      workspace_id: population.answer.workspace_id,
      identity: population.answer.identity,
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

  retryOpeningContext(): void {
    const population = this.state.population;
    if (population.phase === "ready" && this.state.openingContext.phase === "failed") this.requestOpeningContext(population.answer);
  }

  retryVariants(): void {
    const population = this.state.population;
    if (population.phase === "ready" && this.state.variants.phase === "failed") this.requestVariants(population.answer);
  }

  /** Lists the incidents of one variant of the current answer in the table; the population stays as it is. */
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
    this.cancelCaseRequest();
    this.cancelViewRequests();
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
    this.publish({
      population: checked.ok
        ? { phase: "ready", revision, target, answer: checked.answer }
        : { phase: "failed", revision, target, problem: checked.problem },
      inspected: { phase: "closed" },
      ...noViews,
    });
    if (checked.ok) {
      this.requestOpeningContext(checked.answer);
      this.requestVariants(checked.answer);
    }
  }

  private viewRequest<Kind extends "opening_context_request" | "variants_request">(messageType: Kind, population: ImportedPopulationAnswer) {
    this.viewRequestSequence += 1;
    const prefix = messageType === "opening_context_request" ? "opening" : "variants";
    return {
      schema_version: 1 as const,
      message_type: messageType,
      request_id: `${prefix}-${this.revision}-${this.viewRequestSequence}`,
      query_revision: this.revision,
      workspace_id: population.workspace_id,
      identity: population.identity,
    };
  }

  private requestOpeningContext(population: ImportedPopulationAnswer): void {
    this.openingRequest?.controller.abort();
    const request: OpeningContextRequest = this.viewRequest("opening_context_request", population);
    const pending = { requestId: request.request_id, controller: new AbortController() };
    this.openingRequest = pending;
    this.publish({ ...this.state, openingContext: { phase: "loading" } });
    this.views.openingContext(request, pending.controller.signal).then(
      (outcome) => this.receiveOpeningContext(request, outcome),
      () => this.receiveOpeningContext(request, viewUnreachable),
    );
  }

  private requestVariants(population: ImportedPopulationAnswer): void {
    this.variantsRequest?.controller.abort();
    const request: VariantsRequest = this.viewRequest("variants_request", population);
    const pending = { requestId: request.request_id, controller: new AbortController() };
    this.variantsRequest = pending;
    this.publish({ ...this.state, variants: { phase: "loading" }, chosenVariant: null });
    this.views.variants(request, pending.controller.signal).then(
      (outcome) => this.receiveVariants(request, outcome),
      () => this.receiveVariants(request, viewUnreachable),
    );
  }

  private receiveOpeningContext(request: OpeningContextRequest, outcome: ViewOutcome<OpeningContextAnswer>): void {
    if (request.query_revision !== this.revision || request.request_id !== this.openingRequest?.requestId) return;
    this.openingRequest = null;
    const checked = outcome.ok ? checkView(request, outcome.answer) : checkViewProblem(request, outcome.problem);
    this.publish({ ...this.state, openingContext: checked.ok ? { phase: "ready", answer: checked.answer } : { phase: "failed", problem: checked.problem } });
  }

  private receiveVariants(request: VariantsRequest, outcome: ViewOutcome<VariantsAnswer>): void {
    if (request.query_revision !== this.revision || request.request_id !== this.variantsRequest?.requestId) return;
    this.variantsRequest = null;
    const checked = outcome.ok ? checkView(request, outcome.answer) : checkViewProblem(request, outcome.problem);
    this.publish({ ...this.state, variants: checked.ok ? { phase: "ready", answer: checked.answer } : { phase: "failed", problem: checked.problem } });
  }

  private cancelViewRequests(): void {
    this.openingRequest?.controller.abort();
    this.variantsRequest?.controller.abort();
    this.openingRequest = null;
    this.variantsRequest = null;
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
