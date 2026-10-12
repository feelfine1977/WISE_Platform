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

export interface ImportedInvestigationState {
  population: ImportedPopulationState;
  inspected: ImportedCaseState;
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
  private state: ImportedInvestigationState = { population: { phase: "idle" }, inspected: { phase: "closed" } };
  private revision = 0;
  private caseRequestSequence = 0;
  private currentCaseRequestId: string | null = null;
  private populationRequest: AbortController | null = null;
  private caseRequest: AbortController | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly client: ImportClient) {}

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
    const request: OpenPopulationRequest = {
      schema_version: 1,
      message_type: "open_population_request",
      request_id: `population-${revision}`,
      query_revision: revision,
      workspace_id: target.workspaceId,
      preparation_id: target.preparationId,
    };
    this.publish({ population: { phase: "loading", revision, target }, inspected: { phase: "closed" } });
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

  /** Abandons every outstanding request; replies to them are dropped when they arrive. */
  stop(): void {
    this.revision += 1;
    this.populationRequest?.abort();
    this.populationRequest = null;
    this.cancelCaseRequest();
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
    });
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
