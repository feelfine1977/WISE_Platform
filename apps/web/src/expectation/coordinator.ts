import { sameJson } from "../data/coordinator";
import type {
  AnswerIdentity,
  CaseId,
  ExpectationValidationAnswer,
  NamedPopulation,
  ResolutionDefinition,
  ScoreCaseWitnessAnswer,
  ScoreCaseWitnessRequest,
  ScoreExpectationRequest,
  ReadScoreRunRequest,
  ScoreRun,
  ScoreRunAnswer,
  ValidateExpectationRequest,
  WorkspaceId,
} from "../generated/scoring";
import type { ScoreRunReference } from "../generated/saving";
import { type ImportedInvestigationCoordinator, type PreparationTarget } from "../imported/coordinator";
import { type DefinitionForm, emptyForm } from "./definition";
import type { ScoringClient, ScoringOutcome, ScoringProblem } from "./client";
import { checkStateCounts, type OutcomeState } from "./wording";

/** The incidents an expectation is checked and scored for: a named population of a preparation. */
export interface ScoringTarget {
  workspaceId: WorkspaceId;
  baseIdentity: AnswerIdentity;
  population: NamedPopulation;
}

export type ValidationState =
  | { phase: "idle" }
  | { phase: "loading"; request: ValidateExpectationRequest }
  | { phase: "ready"; request: ValidateExpectationRequest; answer: ExpectationValidationAnswer }
  | { phase: "failed"; request: ValidateExpectationRequest; problem: ScoringProblem };

/** The run asked for now; the last answered run stays shown, marked as pending or failed, until it is answered. */
export type RunRequest = ScoreExpectationRequest | ReadScoreRunRequest;

export type RunState =
  | { phase: "idle" }
  | { phase: "loading"; request: RunRequest; shown: ScoreRun | null }
  | { phase: "ready"; request: RunRequest; run: ScoreRun }
  | { phase: "failed"; request: RunRequest; problem: ScoringProblem; shown: ScoreRun | null };

export type WitnessState =
  | { phase: "closed" }
  | { phase: "loading"; caseId: CaseId }
  | { phase: "ready"; caseId: CaseId; answer: ScoreCaseWitnessAnswer }
  | { phase: "failed"; caseId: CaseId; problem: ScoringProblem };

export interface ExpectationState {
  /** Authored input belongs to this coordinator, so changing areas does not discard it. */
  form: DefinitionForm;
  validation: ValidationState;
  run: RunState;
  /** The state whose incidents the table lists until the choice is cleared; a view of the run, not a selection. */
  chosen: OutcomeState | null;
  witness: WitnessState;
}

/** The run whose answer is shown, if one is. */
export function shownRun(run: RunState): ScoreRun | null {
  switch (run.phase) {
    case "idle":
      return null;
    case "ready":
      return run.run;
    default:
      return run.shown;
  }
}

const initialState: ExpectationState = { form: emptyForm, validation: { phase: "idle" }, run: { phase: "idle" }, chosen: null, witness: { phase: "closed" } };
const unreachable: ScoringOutcome<never> = { ok: false, problem: { kind: "unreachable" } };

function mismatch(detail: string): ScoringOutcome<never> {
  return { ok: false, problem: { kind: "unsupported_reply", detail } };
}

/**
 * Holds the query revision of the expectation and is the only place where its replies are
 * published: the check of a definition, the run of a checked definition, and the records of one
 * scored incident. Every check and every score starts a new revision; a reply to a check or a
 * score that is no longer the latest of its kind, or to another request, is dropped, whether it is
 * an answer, a refusal or a failure. Choosing a state only lists incidents of the run shown:
 * nothing is asked of the local service for it.
 */
export class ExpectationCoordinator {
  private state: ExpectationState = initialState;
  private revision = 0;
  private witnessSequence = 0;
  private validationRequest: { revision: number; controller: AbortController } | null = null;
  private runRequest: { revision: number; controller: AbortController } | null = null;
  private witnessRequest: { requestId: string; controller: AbortController } | null = null;
  private readonly listeners = new Set<() => void>();

  private reading: { workspaceId: WorkspaceId; identity: AnswerIdentity } | null = null;
  private shownWorkspace: WorkspaceId | null = null;
  private restoreReference: ScoreRunReference | null = null;
  private deferredRestore: ScoreRunReference | null = null;
  private restoreTarget: PreparationTarget | null = null;
  private restoreBinding: string | null = null;
  private acceptedRunRequest: RunRequest | null = null;
  private unsubscribeInvestigation: (() => void) | null = null;

  constructor(private readonly client: ScoringClient, private readonly investigation: ImportedInvestigationCoordinator) {}

  /** The App owner starts this once per effect setup; safe under StrictMode replay. */
  start(): void {
    if (this.unsubscribeInvestigation !== null) return;
    this.unsubscribeInvestigation = this.investigation.subscribe(() => this.investigationChanged());
    this.investigationChanged();
  }

  setForm(form: DefinitionForm): void {
    this.publish({ ...this.state, form });
  }

  /** The shown run can belong to an earlier subset of this same reading. */
  savedReference(): ScoreRunReference | null {
    const run = shownRun(this.state.run);
    const population = this.investigation.getState().population;
    if (run === null || population.phase !== "ready" || this.shownWorkspace !== population.answer.workspace_id ||
        !sameJson(run.identity.base_identity, population.answer.identity)) return null;
    return { score_run_id: run.identity.run_id, scored_population_id: run.identity.scored_population_identity.population_id,
      calibration_id: run.identity.calibration_id };
  }

  /** Reopens a saved immutable run through READ only, once its preparation is open. */
  restore(reference: ScoreRunReference | null): void {
    this.validationRequest?.controller.abort();
    this.validationRequest = null;
    this.runRequest?.controller.abort();
    this.runRequest = null;
    this.closeWitness();
    this.restoreReference = reference;
    this.deferredRestore = reference;
    const investigated = this.investigation.getState();
    this.restoreTarget = investigated.replacement?.asked.target ??
      (investigated.population.phase === "idle" ? null : investigated.population.target);
    this.restoreBinding = investigated.replacement?.asked.restoration?.binding.revisionId ?? investigated.saved?.revisionId ?? null;
    if (reference === null) {
      this.shownWorkspace = null;
      this.acceptedRunRequest = null;
      this.publish({ ...this.state, validation: { phase: "idle" }, run: { phase: "idle" }, chosen: null });
    } else {
      this.publish({ ...this.state, validation: { phase: "idle" } });
      this.readRestoredRun();
    }
  }

  private investigationChanged(): void {
    const investigated = this.investigation.getState();
    const population = investigated.population;
    if (population.phase === "idle") return;
    if (investigated.replacement !== null) {
      if (investigated.replacement.phase === "running") {
        this.cancelRequests();
        const shown = shownRun(this.state.run);
        this.publish({ ...this.state, validation: { phase: "idle" }, witness: { phase: "closed" },
          run: shown !== null && this.acceptedRunRequest !== null
            ? { phase: "ready", request: this.acceptedRunRequest, run: shown } : { phase: "idle" } });
      }
      return;
    }
    const target = population.target;
    const changedTarget = this.reading !== null &&
      (target.workspaceId !== this.reading.workspaceId || target.preparationId !== this.reading.identity.preparation_id);
    const changedIdentity = population.phase === "ready" && this.reading !== null &&
      !sameJson(population.answer.identity, this.reading.identity);
    if (changedTarget || changedIdentity) {
      const matchedRestore = this.deferredRestore !== null && this.restoreTarget !== null &&
        this.restoreTarget.workspaceId === target.workspaceId && this.restoreTarget.preparationId === target.preparationId &&
        (this.restoreBinding === null || this.restoreBinding === investigated.saved?.revisionId);
      this.cancelRequests();
      this.reading = null;
      this.shownWorkspace = null;
      this.acceptedRunRequest = null;
      if (!matchedRestore) { this.restoreReference = null; this.deferredRestore = null; this.restoreTarget = null; this.restoreBinding = null; }
      this.publish({ ...initialState, form: { ...emptyForm } });
    }
    if (population.phase === "ready") {
      this.reading = { workspaceId: population.answer.workspace_id, identity: population.answer.identity };
      this.readRestoredRun();
    }
  }

  private readRestoredRun(): void {
    const reference = this.deferredRestore;
    const investigated = this.investigation.getState();
    const population = investigated.population;
    if (reference === null || investigated.replacement !== null || population.phase !== "ready" || this.restoreTarget === null ||
        this.restoreTarget.workspaceId !== population.answer.workspace_id || this.restoreTarget.preparationId !== population.answer.identity.preparation_id ||
        (this.restoreBinding !== null && this.restoreBinding !== investigated.saved?.revisionId)) return;
    this.deferredRestore = null;
    const request: ReadScoreRunRequest = { schema_version: 1, message_type: "read_score_run_request",
      request_id: `read-run-${this.nextRevision()}`, query_revision: this.revision,
      workspace_id: population.answer.workspace_id, run_id: reference.score_run_id };
    const controller = new AbortController();
    this.runRequest = { revision: request.query_revision, controller };
    this.publish({ ...this.state, validation: { phase: "idle" },
      run: { phase: "loading", request, shown: shownRun(this.state.run) } });
    const absent: ScoringOutcome<ScoreRunAnswer> = mismatch("This client cannot read a saved score run.");
    const reply = this.client.readRun?.(request, controller.signal) ?? Promise.resolve(absent);
    reply.then((outcome) => this.receiveRestoredRun(request, reference, population.answer.identity, outcome),
      () => this.receiveRestoredRun(request, reference, population.answer.identity, unreachable));
  }

  private receiveRestoredRun(request: ReadScoreRunRequest, reference: ScoreRunReference, base: AnswerIdentity,
    outcome: ScoringOutcome<ScoreRunAnswer>): void {
    if (request.query_revision !== this.runRequest?.revision) return;
    this.runRequest = null;
    const checked = outcome.ok ? checkRead(request, reference, base, outcome.answer) : checkProblem(request, outcome.problem);
    if (!checked.ok) {
      this.publish({ ...this.state, run: { phase: "failed", request, problem: checked.problem, shown: shownRun(this.state.run) } });
      return;
    }
    const run = checked.answer.run;
    const previous = shownRun(this.state.run);
    if (previous === null || previous.identity.run_id !== run.identity.run_id) this.closeWitness();
    this.shownWorkspace = request.workspace_id;
    this.acceptedRunRequest = request;
    const definition = run.definition_version.definition;
    const form = this.state.form.name === "" && definition.unit === "hours" && definition.missing_response !== "censor"
      ? { name: definition.name, owner: definition.provenance.owner_label, sourceLabel: definition.provenance.source_label,
        rationale: definition.provenance.rationale, start: definition.endpoints.activation_activity,
        response: definition.endpoints.response_activity, target: String(definition.target), width: String(definition.width),
        missing: definition.missing_response, reviewed: definition.review_state === "reviewed" }
      : this.state.form;
    this.publish({ ...this.state, form, run: { phase: "ready", request, run }, chosen: null });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): ExpectationState => this.state;

  /** Asks whether a definition is ready to be scored for the target's incidents. */
  check(target: ScoringTarget, definition: ResolutionDefinition): void {
    if (this.investigation.getState().replacement?.phase === "running") return;
    const population = this.investigation.getState().population;
    if (population.phase !== "idle" && (target.workspaceId !== population.target.workspaceId || target.baseIdentity.preparation_id !== population.target.preparationId)) return;
    if (population.phase === "ready" && (target.workspaceId !== population.answer.workspace_id ||
        !sameJson(target.baseIdentity, population.answer.identity))) return;
    this.reading = { workspaceId: target.workspaceId, identity: target.baseIdentity };
    const revision = this.nextRevision();
    const request: ValidateExpectationRequest = {
      schema_version: 1,
      message_type: "validate_expectation_request",
      request_id: `validate-${revision}`,
      query_revision: revision,
      workspace_id: target.workspaceId,
      base_identity: target.baseIdentity,
      named_population: target.population,
      definition,
    };
    this.publish({ ...this.state, validation: { phase: "loading", request } });
    this.validationRequest?.controller.abort();
    const controller = new AbortController();
    this.validationRequest = { revision, controller };
    this.client.validate(request, controller.signal).then(
      (outcome) => this.receiveValidation(request, outcome),
      () => this.receiveValidation(request, unreachable),
    );
  }

  retryCheck(): void {
    const validation = this.state.validation;
    if (validation.phase !== "failed") return;
    const { workspace_id, base_identity, named_population, definition } = validation.request;
    this.check({ workspaceId: workspace_id, baseIdentity: base_identity, population: named_population }, definition);
  }

  /** Scores the checked definition for the incidents it was checked for; only a ready, reviewed version is scored. */
  score(): void {
    if (this.investigation.getState().replacement?.phase === "running") return;
    const validation = this.state.validation;
    if (validation.phase !== "ready" || validation.answer.state !== "ready" || !validation.answer.definition_version) return;
    if (validation.answer.definition_version.definition.review_state !== "reviewed") return;
    this.scoreRequest({
      workspace_id: validation.request.workspace_id,
      base_identity: validation.request.base_identity,
      named_population: validation.request.named_population,
      definition_version_id: validation.answer.definition_version.definition_version_id,
    });
  }

  retryScore(): void {
    if (this.investigation.getState().replacement?.phase === "running") return;
    const run = this.state.run;
    if (run.phase !== "failed") return;
    if (run.request.message_type === "read_score_run_request") {
      this.restore(this.restoreReference);
      return;
    }
    const { workspace_id, base_identity, named_population, definition_version_id } = run.request;
    this.scoreRequest({ workspace_id, base_identity, named_population, definition_version_id });
  }

  /** Lists the incidents of the run shown that are in a state; the run and its counts stay as they are. */
  choose(state: OutcomeState): void {
    if (shownRun(this.state.run) !== null && this.state.chosen !== state) this.publish({ ...this.state, chosen: state });
  }

  clearChoice(): void {
    if (this.state.chosen !== null) this.publish({ ...this.state, chosen: null });
  }

  /** Opens the records of one incident of the run shown, as the run stored them. */
  openCase(caseId: CaseId): void {
    if (this.investigation.getState().replacement?.phase === "running") return;
    const run = shownRun(this.state.run);
    if (run === null) return;
    this.witnessRequest?.controller.abort();
    this.witnessSequence += 1;
    const request: ScoreCaseWitnessRequest = {
      schema_version: 1,
      message_type: "score_case_witness_request",
      request_id: `witness-${this.revision}-${this.witnessSequence}`,
      query_revision: this.revision,
      workspace_id: this.runWorkspace(),
      run_id: run.identity.run_id,
      case_id: caseId,
    };
    const pending = { requestId: request.request_id, controller: new AbortController() };
    this.witnessRequest = pending;
    this.publish({ ...this.state, witness: { phase: "loading", caseId } });
    this.client.caseWitness(request, pending.controller.signal).then(
      (outcome) => this.receiveWitness(request, run, outcome),
      () => this.receiveWitness(request, run, unreachable),
    );
  }

  retryCase(): void {
    if (this.state.witness.phase === "failed") this.openCase(this.state.witness.caseId);
  }

  closeCase(): void {
    this.witnessRequest?.controller.abort();
    this.witnessRequest = null;
    if (this.state.witness.phase !== "closed") this.publish({ ...this.state, witness: { phase: "closed" } });
  }

  /** Abandons every outstanding request; replies to them are dropped when they arrive. */
  stop(): void {
    this.unsubscribeInvestigation?.();
    this.unsubscribeInvestigation = null;
    this.cancelRequests();
    const shown = shownRun(this.state.run);
    this.publish({ ...this.state, validation: { phase: "idle" }, witness: { phase: "closed" },
      run: shown !== null && this.acceptedRunRequest !== null
        ? { phase: "ready", request: this.acceptedRunRequest, run: shown } : { phase: "idle" } });
  }

  private cancelRequests(): void {
    this.revision += 1;
    this.validationRequest?.controller.abort();
    this.validationRequest = null;
    this.runRequest?.controller.abort();
    this.runRequest = null;
    this.witnessRequest?.controller.abort();
    this.witnessRequest = null;
  }

  private scoreRequest(fields: Pick<ScoreExpectationRequest, "workspace_id" | "base_identity" | "named_population" | "definition_version_id">): void {
    const revision = this.nextRevision();
    const request: ScoreExpectationRequest = {
      schema_version: 1,
      message_type: "score_expectation_request",
      request_id: `score-${revision}`,
      query_revision: revision,
      ...fields,
    };
    this.publish({ ...this.state, run: { phase: "loading", request, shown: shownRun(this.state.run) } });
    this.runRequest?.controller.abort();
    const controller = new AbortController();
    this.runRequest = { revision, controller };
    this.client.score(request, controller.signal).then(
      (outcome) => this.receiveRun(request, outcome),
      () => this.receiveRun(request, unreachable),
    );
  }

  private receiveValidation(request: ValidateExpectationRequest, outcome: ScoringOutcome<ExpectationValidationAnswer>): void {
    if (request.query_revision !== this.validationRequest?.revision) return;
    this.validationRequest = null;
    const checked = outcome.ok ? checkValidation(request, outcome.answer) : checkProblem(request, outcome.problem);
    this.publish({
      ...this.state,
      validation: checked.ok ? { phase: "ready", request, answer: checked.answer } : { phase: "failed", request, problem: checked.problem },
    });
  }

  private receiveRun(request: ScoreExpectationRequest, outcome: ScoringOutcome<ScoreRunAnswer>): void {
    if (request.query_revision !== this.runRequest?.revision) return;
    this.runRequest = null;
    const checked = outcome.ok ? checkRun(request, outcome.answer) : checkProblem(request, outcome.problem);
    if (!checked.ok) {
      this.publish({ ...this.state, run: { phase: "failed", request, problem: checked.problem, shown: shownRun(this.state.run) } });
      return;
    }
    const previous = shownRun(this.state.run);
    const run = checked.answer.run;
    this.shownWorkspace = request.workspace_id;
    this.acceptedRunRequest = request;
    this.restoreReference = null;
    const same = previous !== null && previous.identity.run_id === run.identity.run_id;
    if (!same) this.closeWitness();
    this.publish({ ...this.state, run: { phase: "ready", request, run }, chosen: same ? this.state.chosen : null });
  }

  private receiveWitness(request: ScoreCaseWitnessRequest, run: ScoreRun, outcome: ScoringOutcome<ScoreCaseWitnessAnswer>): void {
    if (request.request_id !== this.witnessRequest?.requestId) return;
    this.witnessRequest = null;
    const caseId = request.case_id;
    const checked = outcome.ok ? checkWitness(request, run, outcome.answer) : checkProblem(request, outcome.problem);
    this.publish({
      ...this.state,
      witness: checked.ok ? { phase: "ready", caseId, answer: checked.answer } : { phase: "failed", caseId, problem: checked.problem },
    });
  }

  private closeWitness(): void {
    this.witnessRequest?.controller.abort();
    this.witnessRequest = null;
    this.state = { ...this.state, witness: { phase: "closed" } };
  }

  private runWorkspace(): WorkspaceId {
    return this.shownWorkspace ?? "";
  }

  private nextRevision(): number {
    this.revision += 1;
    return this.revision;
  }

  private publish(state: ExpectationState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

interface Envelope {
  request_id: string;
  query_revision: number;
  workspace_id: string;
}

function sameEnvelope(request: Envelope, answer: Envelope): ScoringOutcome<never> | null {
  if (answer.request_id !== request.request_id || answer.query_revision !== request.query_revision) {
    return mismatch("The reply names a different request or query revision.");
  }
  if (answer.workspace_id !== request.workspace_id) return mismatch("The reply belongs to a different workspace.");
  return null;
}

/** A refusal that names another request or revision does not answer this one. */
function checkProblem(request: Envelope, problem: ScoringProblem): ScoringOutcome<never> {
  if (problem.kind === "refusal") {
    const { request_id, query_revision, workspace_id } = problem.refusal;
    if ((request_id !== null && request_id !== request.request_id) || (query_revision !== null && query_revision !== request.query_revision)) {
      return mismatch("The refusal names a different request or query revision.");
    }
    if (workspace_id !== null && workspace_id !== request.workspace_id) return mismatch("The refusal belongs to a different workspace.");
  }
  return { ok: false, problem };
}

const boundFields = ["source_id", "preparation_id", "representation_id", "case_dictionary_id", "implementation_version"] as const;

function checkValidation(request: ValidateExpectationRequest, answer: ExpectationValidationAnswer): ScoringOutcome<ExpectationValidationAnswer> {
  const different = sameEnvelope(request, answer);
  if (different) return different;
  const version = answer.definition_version;
  if (version) {
    if (!sameJson(version.definition, request.definition)) return mismatch("The reply checked a different definition.");
    if (boundFields.some((field) => version.source_binding[field] !== request.base_identity[field])) {
      return mismatch("The reply checked the definition for a different preparation.");
    }
  }
  return { ok: true, answer };
}

function checkRun(request: ScoreExpectationRequest, answer: ScoreRunAnswer): ScoringOutcome<ScoreRunAnswer> {
  const different = sameEnvelope(request, answer);
  if (different) return different;
  const { identity } = answer.run;
  if (identity.definition_version_id !== request.definition_version_id) return mismatch("The reply scored a different definition.");
  if (!sameJson(identity.base_identity, request.base_identity)) return mismatch("The reply belongs to a different preparation.");
  if (!sameJson(identity.scored_population_identity, request.named_population.identity)) {
    return mismatch("The reply scored different cases.");
  }
  const disagreement = checkStateCounts(answer.run);
  if (disagreement) return mismatch(disagreement);
  return { ok: true, answer };
}

function checkWitness(request: ScoreCaseWitnessRequest, run: ScoreRun, answer: ScoreCaseWitnessAnswer): ScoringOutcome<ScoreCaseWitnessAnswer> {
  const different = sameEnvelope(request, answer);
  if (different) return different;
  if (!sameJson(answer.run_identity, run.identity)) return mismatch("The reply belongs to a different run.");
  if (answer.case.case_id !== request.case_id) return mismatch("The reply describes a different case.");
  return { ok: true, answer };
}


function checkRead(request: ReadScoreRunRequest, reference: ScoreRunReference, base: AnswerIdentity,
  answer: ScoreRunAnswer): ScoringOutcome<ScoreRunAnswer> {
  const different = sameEnvelope(request, answer);
  if (different) return different;
  const { identity } = answer.run;
  if (identity.run_id !== reference.score_run_id || identity.scored_population_identity.population_id !== reference.scored_population_id ||
      identity.calibration_id !== reference.calibration_id) return mismatch("The reply does not name the saved score run, population and calibration.");
  if (!sameJson(identity.base_identity, base)) return mismatch("The saved run belongs to a different preparation.");
  const disagreement = checkStateCounts(answer.run);
  return disagreement ? mismatch(disagreement) : { ok: true, answer };
}
