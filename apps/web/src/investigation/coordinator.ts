import type {
  AnswerIdentity,
  CaseEvidenceAnswer,
  CaseEvidenceRequest,
  CaseId,
  ExampleId,
  OpenExampleRequest,
  PopulationAnswer,
} from "../generated/investigation";
import type { InvestigationClient, Outcome, Problem } from "./client";
import { defaultExampleId, examplePolicies } from "./policies";

export type PopulationState =
  | { phase: "idle" }
  | { phase: "loading"; revision: number; exampleId: ExampleId }
  | { phase: "ready"; revision: number; exampleId: ExampleId; answer: PopulationAnswer }
  | { phase: "failed"; revision: number; exampleId: ExampleId; problem: Problem };

export type InspectedCaseState =
  | { phase: "closed" }
  | { phase: "loading"; caseId: CaseId }
  | { phase: "ready"; caseId: CaseId; answer: CaseEvidenceAnswer }
  | { phase: "failed"; caseId: CaseId; problem: Problem };

export interface InvestigationState {
  population: PopulationState;
  inspected: InspectedCaseState;
}

const unreachable: Outcome<never> = { ok: false, problem: { kind: "unreachable" } };

/**
 * Holds the current query revision and is the only place where replies are published.
 * Every request carries the revision it was issued under; a reply whose revision or request is no
 * longer current is dropped, whether it is an answer, a refusal or a failure.
 */
export class InvestigationCoordinator {
  private state: InvestigationState = { population: { phase: "idle" }, inspected: { phase: "closed" } };
  private revision = 0;
  private caseRequestSequence = 0;
  private currentCaseRequestId: string | null = null;
  private populationRequest: AbortController | null = null;
  private caseRequest: AbortController | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly client: InvestigationClient) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): InvestigationState => this.state;

  /** Opens the default example unless a question is already open or on its way. */
  start(exampleId: ExampleId = defaultExampleId): void {
    if (this.state.population.phase === "idle") this.openExample(exampleId);
  }

  /**
   * Abandons every outstanding request and returns to the idle state without publishing, so that a
   * later start opens a fresh question. Replies to the abandoned requests are dropped when they arrive.
   */
  stop(): void {
    this.revision += 1;
    this.populationRequest?.abort();
    this.populationRequest = null;
    this.cancelCaseRequest();
    this.state = { population: { phase: "idle" }, inspected: { phase: "closed" } };
  }

  openExample(exampleId: ExampleId): void {
    this.revision += 1;
    const revision = this.revision;
    this.populationRequest?.abort();
    this.cancelCaseRequest();
    const request: OpenExampleRequest = {
      schema_version: 1,
      message_type: "open_example_request",
      request_id: `open-${revision}`,
      query_revision: revision,
      example_id: exampleId,
      policies: examplePolicies,
    };
    this.publish({ population: { phase: "loading", revision, exampleId }, inspected: { phase: "closed" } });
    const controller = new AbortController();
    this.populationRequest = controller;
    this.client.openExample(request, controller.signal).then(
      (outcome) => this.receivePopulation(request, outcome),
      () => this.receivePopulation(request, unreachable),
    );
  }

  retryPopulation(): void {
    const population = this.state.population;
    if (population.phase === "failed") this.openExample(population.exampleId);
  }

  openCase(caseId: CaseId): void {
    const population = this.state.population;
    if (population.phase !== "ready") return;
    this.cancelCaseRequest();
    this.caseRequestSequence += 1;
    const request: CaseEvidenceRequest = {
      schema_version: 1,
      message_type: "case_evidence_request",
      request_id: `case-${population.revision}-${this.caseRequestSequence}`,
      query_revision: population.revision,
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

  private receivePopulation(request: OpenExampleRequest, outcome: Outcome<PopulationAnswer>): void {
    if (request.query_revision !== this.revision) return;
    this.populationRequest = null;
    const revision = request.query_revision;
    const exampleId = request.example_id;
    const checked = outcome.ok ? checkPopulationAnswer(request, outcome.answer) : checkProblem(request, outcome.problem);
    this.publish({
      population: checked.ok
        ? { phase: "ready", revision, exampleId, answer: checked.answer }
        : { phase: "failed", revision, exampleId, problem: checked.problem },
      inspected: { phase: "closed" },
    });
  }

  private receiveCase(request: CaseEvidenceRequest, outcome: Outcome<CaseEvidenceAnswer>): void {
    if (request.query_revision !== this.revision || request.request_id !== this.currentCaseRequestId) return;
    this.caseRequest = null;
    this.currentCaseRequestId = null;
    const caseId = request.case_id;
    const checked = outcome.ok ? checkCaseAnswer(request, outcome.answer) : checkProblem(request, outcome.problem);
    this.publish({
      ...this.state,
      inspected: checked.ok
        ? { phase: "ready", caseId, answer: checked.answer }
        : { phase: "failed", caseId, problem: checked.problem },
    });
  }

  private cancelCaseRequest(): void {
    this.caseRequest?.abort();
    this.caseRequest = null;
    this.currentCaseRequestId = null;
  }

  private publish(state: InvestigationState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

function mismatch(detail: string): Outcome<never> {
  return { ok: false, problem: { kind: "unsupported_reply", detail } };
}

/** A refusal that names another request or revision does not answer this one. */
function checkProblem(request: OpenExampleRequest | CaseEvidenceRequest, problem: Problem): Outcome<never> {
  if (problem.kind === "refusal") {
    const { request_id, query_revision } = problem.refusal;
    if ((request_id !== null && request_id !== request.request_id) || (query_revision !== null && query_revision !== request.query_revision)) {
      return mismatch("The refusal names a different request or query revision.");
    }
  }
  return { ok: false, problem };
}

function checkPopulationAnswer(request: OpenExampleRequest, answer: PopulationAnswer): Outcome<PopulationAnswer> {
  if (answer.request_id !== request.request_id || answer.query_revision !== request.query_revision) {
    return mismatch("The reply names a different request or query revision.");
  }
  if (answer.source.example_id !== request.example_id) return mismatch("The reply describes a different example.");
  if (!sameJson(answer.policies, request.policies)) return mismatch("The reply was computed under different policies.");
  return { ok: true, answer };
}

function checkCaseAnswer(request: CaseEvidenceRequest, answer: CaseEvidenceAnswer): Outcome<CaseEvidenceAnswer> {
  if (answer.request_id !== request.request_id || answer.query_revision !== request.query_revision) {
    return mismatch("The reply names a different request or query revision.");
  }
  if (answer.case_id !== request.case_id) return mismatch("The reply describes a different incident.");
  if (!sameIdentity(answer.identity, request.identity)) return mismatch("The reply belongs to a different population identity.");
  return { ok: true, answer };
}

function sameIdentity(left: AnswerIdentity, right: AnswerIdentity): boolean {
  return (
    left.source_id === right.source_id &&
    left.preparation_id === right.preparation_id &&
    left.representation_id === right.representation_id &&
    left.case_dictionary_id === right.case_dictionary_id &&
    left.population_id === right.population_id &&
    left.implementation_version === right.implementation_version
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) => Object.hasOwn(right, key) && sameJson((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
  );
}
