import type { WorkspaceId } from "../generated/imports";
import type {
  EvidenceBookmark,
  ListSavedAnswer,
  ListSavedRequest,
  PresentationRecovery,
  ReopenInvestigationAnswer,
  ReopenInvestigationRequest,
  SaveInvestigationAnswer,
  SaveInvestigationRequest,
  SavedComparison,
  SavedInvestigationSummary,
  ScoreRunReference,
} from "../generated/saving";
import {
  type ImportedInvestigationCoordinator,
  type ImportedInvestigationState,
  type InvestigationView,
  shownSelection,
} from "../imported/coordinator";
import type { SavingClient, SavingOutcome, SavingProblem } from "./client";

const contextPolicy = "incident.context.first_record_in_declared_order.v1" as const;

export type SavedListState =
  | { phase: "idle" }
  | { phase: "loading"; workspaceId: WorkspaceId }
  | { phase: "ready"; workspaceId: WorkspaceId; answer: ListSavedAnswer }
  | { phase: "failed"; workspaceId: WorkspaceId; problem: SavingProblem };

export type ReopenState =
  | { phase: "idle" }
  | { phase: "reopening"; summary: SavedInvestigationSummary }
  | { phase: "failed"; summary: SavedInvestigationSummary; problem: SavingProblem };

export type SaveState =
  | { phase: "idle" }
  | { phase: "saving"; name: string }
  | { phase: "saved"; answer: SaveInvestigationAnswer }
  | { phase: "failed"; problem: SavingProblem };

export interface SavingState {
  list: SavedListState;
  reopen: ReopenState;
  save: SaveState;
}

/** The part of the comparison view that saving needs: the comparison shown on a reading, in its saved form. */
export interface ComparisonSource {
  savedComparisonFor(workspaceId: WorkspaceId, identity: SaveInvestigationRequest["base_identity"]): SavedComparison | null;
  /** Shows the comparison of a reopened investigation again, or forgets one that was waiting when there is none. */
  restore(workspaceId: WorkspaceId, identity: SaveInvestigationRequest["base_identity"], saved: SavedComparison | null): void;
}

/** The part of the expectation view that saving needs: the score run shown, as a saved investigation refers to it. */
export interface ScoreSource {
  savedReference(): ScoreRunReference | null;
  /** Shows the score run of a reopened investigation again by reading it, or none when it refers to none. */
  restore(reference: ScoreRunReference | null): void;
}

/** What a save of the question shown would hold, or why it cannot be saved now. */
export type SaveDraft =
  | { ready: false; reason: string }
  | {
      ready: true;
      /** Whether the save adds a revision to an investigation saved before. */
      revises: boolean;
      name: string;
      notes: string;
      /** Bookmarks pinned to a selection that is no longer the one shown; the earlier revision keeps them. */
      leftBehind: number;
    };

const initialState: SavingState = { list: { phase: "idle" }, reopen: { phase: "idle" }, save: { phase: "idle" } };

const unreachable: SavingOutcome<never> = { ok: false, problem: { kind: "unreachable" } };

/** Whether two identities name the same source, reading, representation, dictionary, population and version. */
function sameIdentity(one: object, other: object): boolean {
  const left = one as Record<string, unknown>;
  const right = other as Record<string, unknown>;
  const names = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...names].every((name) => left[name] === right[name]);
}

function mismatch(detail: string): SavingOutcome<never> {
  return { ok: false, problem: { kind: "unsupported_reply", detail } };
}

/**
 * Saves the question the imported investigation shows, lists the investigations saved in a
 * workspace, and reopens one of them into the imported investigation. Each request carries a new
 * query revision; a reply is published only while its request is the current one of its kind.
 * Nothing here computes a count or a membership: a reopened question is shown only once the local
 * service has answered its population and selection again.
 */
export class SavingCoordinator {
  private state: SavingState = initialState;
  private revision = 0;
  private readonly current = new Map<keyof SavingState, { requestId: string; controller: AbortController }>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly client: SavingClient,
    private readonly investigation: ImportedInvestigationCoordinator,
    /** Where a comparison made on screen is found, so that saving the investigation keeps it. */
    private readonly comparisons?: ComparisonSource,
    /** Where the score run shown is found, so that saving the investigation refers to it. */
    private readonly scores?: ScoreSource,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): SavingState => this.state;

  /** What saving the question shown now would hold, from the investigation's state. */
  draft(investigation: ImportedInvestigationState): SaveDraft {
    const { population, selection, saved } = investigation;
    if (population.phase !== "ready") return { ready: false, reason: "The incidents are not open yet." };
    if (investigation.replacement?.phase === "running") return { ready: false, reason: "Saving is possible once the other incidents asked for are open." };
    const shown = shownSelection(selection);
    if (selection.phase !== "ready" || shown === null) {
      return { ready: false, reason: "Saving is possible once the incidents of the current steps are selected." };
    }
    const bookmarks = saved?.content.bookmarks ?? [];
    return {
      ready: true,
      revises: saved !== null,
      name: saved?.content.name ?? population.answer.source.filename,
      notes: saved?.content.notes ?? "",
      leftBehind: bookmarks.length - carriedBookmarks(investigation).length,
    };
  }

  /** Saves the question shown under a name and a note; a question saved before gets a new revision. */
  save(name: string, notes: string, view: InvestigationView): void {
    const investigation = this.investigation.getState();
    const { population, selection, saved, parentCaseIds } = investigation;
    const shown = shownSelection(selection);
    if (investigation.replacement?.phase === "running" || population.phase !== "ready" || selection.phase !== "ready" || shown === null || name.trim() === "") return;
    const { requestId, revision, signal } = this.issue("save", "save");
    const presentation: PresentationRecovery = {
      active_view: view === "map" ? "process_map" : "incidents",
      table_sorts: [],
      flow_artifact_sha256: null,
      graph_positions: null,
    };
    const scoreReference = this.scores?.savedReference() ?? saved?.content.score_run_ref ?? null;
    const question = {
      schema_version: 1 as const,
      message_type: "save_investigation_request" as const,
      request_id: requestId,
      query_revision: revision,
      workspace_id: population.answer.workspace_id,
      name,
      base_identity: population.answer.identity,
      selection_identity: shown.answer.identity,
      selection_recipe: { parent_case_ids: parentCaseIds ?? population.answer.population.case_ids, predicates: [...shown.steps] },
      context_policy: contextPolicy,
      // The comparison shown on this reading is saved; without one, the saved investigation keeps its own.
      comparison:
        this.comparisons?.savedComparisonFor(population.answer.workspace_id, population.answer.identity) ??
        saved?.content.comparison ??
        null,
      notes,
      bookmarks: carriedBookmarks(investigation),
      presentation_state: presentation,
      // The score run shown on this reading is referred to; without one, a run the saved investigation
      // refers to stays referred to until it is taken away on purpose.
      ...(scoreReference ? { score_run_ref: scoreReference } : {}),
    };
    // A new investigation names neither an investigation nor the revision it replaces; a new revision names both.
    const request: SaveInvestigationRequest = saved
      ? { ...question, investigation_id: saved.investigationId, expected_revision_id: saved.revisionId }
      : { ...question, investigation_id: null, expected_revision_id: null };
    this.publish({ ...this.state, save: { phase: "saving", name } });
    this.client.save(request, signal).then(
      (outcome) => this.receiveSave(request, outcome),
      () => this.receiveSave(request, unreachable),
    );
  }

  /** Forgets the outcome of the last save, before the save form is opened again. */
  clearSave(): void {
    this.cancel("save");
    if (this.state.save.phase !== "idle") this.publish({ ...this.state, save: { phase: "idle" } });
  }

  list(workspaceId: WorkspaceId): void {
    const { requestId, revision, signal } = this.issue("list", "list");
    const request: ListSavedRequest = {
      schema_version: 1,
      message_type: "list_saved_request",
      request_id: requestId,
      query_revision: revision,
      workspace_id: workspaceId,
    };
    this.publish({ ...this.state, list: { phase: "loading", workspaceId } });
    this.client.listSaved(request, signal).then(
      (outcome) => this.receiveList(request, outcome),
      () => this.receiveList(request, unreachable),
    );
  }

  /**
   * Reopens the latest revision of a saved investigation. The investigation is opened only when the
   * local service restored it; resolves to whether it did.
   */
  reopen(summary: SavedInvestigationSummary, workspaceId: WorkspaceId): Promise<boolean> {
    const { requestId, revision, signal } = this.issue("reopen", "reopen");
    const request: ReopenInvestigationRequest = {
      schema_version: 1,
      message_type: "reopen_investigation_request",
      request_id: requestId,
      query_revision: revision,
      workspace_id: workspaceId,
      saved_revision_id: summary.latest_revision_id,
    };
    this.publish({ ...this.state, reopen: { phase: "reopening", summary } });
    return this.client.reopen(request, signal).then(
      (outcome) => this.receiveReopen(request, summary, outcome),
      () => this.receiveReopen(request, summary, unreachable),
    );
  }

  /** Abandons every outstanding request; replies to them are dropped when they arrive. */
  stop(): void {
    for (const kind of [...this.current.keys()]) this.cancel(kind);
  }

  private receiveSave(request: SaveInvestigationRequest, outcome: SavingOutcome<SaveInvestigationAnswer>): void {
    if (!this.isCurrent("save", request.request_id)) return;
    this.current.delete("save");
    const checked = outcome.ok ? checkSave(request, outcome.answer) : checkProblem(request, outcome.problem);
    if (!checked.ok) {
      this.publish({ ...this.state, save: { phase: "failed", problem: checked.problem } });
      return;
    }
    const { revision } = checked.answer;
    if (!this.stillShows(request)) {
      // The answer is for a question that is no longer the one shown. It was saved and is in the list
      // of saved investigations; the question shown now is another one and is not marked as saved.
      this.publish({ ...this.state, save: { phase: "idle" } });
      return;
    }
    this.investigation.markSaved({ investigationId: revision.investigation_id, revisionId: revision.saved_revision_id, content: revision.content });
    this.publish({ ...this.state, save: { phase: "saved", answer: checked.answer } });
  }

  /** Whether the investigation still shows the question a save request was made for. */
  private stillShows(request: SaveInvestigationRequest): boolean {
    const { population, selection } = this.investigation.getState();
    const shown = shownSelection(selection);
    return (
      population.phase === "ready" &&
      selection.phase === "ready" &&
      shown !== null &&
      population.answer.workspace_id === request.workspace_id &&
      sameIdentity(population.answer.identity, request.base_identity) &&
      sameIdentity(shown.answer.identity, request.selection_identity)
    );
  }

  private receiveList(request: ListSavedRequest, outcome: SavingOutcome<ListSavedAnswer>): void {
    if (!this.isCurrent("list", request.request_id)) return;
    this.current.delete("list");
    const checked = outcome.ok ? checkEcho(request, outcome.answer) : checkProblem(request, outcome.problem);
    const workspaceId = request.workspace_id;
    this.publish({
      ...this.state,
      list: checked.ok ? { phase: "ready", workspaceId, answer: checked.answer } : { phase: "failed", workspaceId, problem: checked.problem },
    });
  }

  private receiveReopen(
    request: ReopenInvestigationRequest,
    summary: SavedInvestigationSummary,
    outcome: SavingOutcome<ReopenInvestigationAnswer>,
  ): boolean {
    if (!this.isCurrent("reopen", request.request_id)) return false;
    this.current.delete("reopen");
    const checked = outcome.ok ? checkReopen(request, outcome.answer) : checkProblem(request, outcome.problem);
    if (!checked.ok) {
      this.publish({ ...this.state, reopen: { phase: "failed", summary, problem: checked.problem } });
      return false;
    }
    const { revision, restored_selection, recovery } = checked.answer;
    const { content } = revision;
    this.investigation.restore({
      target: { workspaceId: request.workspace_id, preparationId: content.base_identity.preparation_id },
      steps: content.selection_recipe.predicates,
      parentCaseIds: content.selection_recipe.parent_case_ids,
      selectionIdentity: restored_selection.identity,
      binding: { investigationId: revision.investigation_id, revisionId: revision.saved_revision_id, content },
      view: recovery.presentation_state?.active_view === "process_map" ? "map" : "incidents",
    });
    this.comparisons?.restore(request.workspace_id, content.base_identity, content.comparison);
    this.scores?.restore(content.score_run_ref ?? null);
    this.publish({ ...this.state, reopen: { phase: "idle" }, save: { phase: "idle" } });
    return true;
  }

  private issue(kind: keyof SavingState, prefix: string): { requestId: string; revision: number; signal: AbortSignal } {
    this.cancel(kind);
    this.revision += 1;
    const requestId = `${prefix}-${this.revision}`;
    const controller = new AbortController();
    this.current.set(kind, { requestId, controller });
    return { requestId, revision: this.revision, signal: controller.signal };
  }

  private isCurrent(kind: keyof SavingState, requestId: string): boolean {
    return this.current.get(kind)?.requestId === requestId;
  }

  private cancel(kind: keyof SavingState): void {
    this.current.get(kind)?.controller.abort();
    this.current.delete(kind);
  }

  private publish(state: SavingState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

/**
 * The bookmarks of the saved question that still name a population of the question shown. A
 * bookmark pinned to the saved selection is left behind once the steps changed; the revision it
 * was saved in keeps it.
 */
function carriedBookmarks(investigation: ImportedInvestigationState): EvidenceBookmark[] {
  const saved = investigation.saved;
  const shown = shownSelection(investigation.selection);
  if (saved === null) return [];
  const before = saved.content.selection_identity.population_id;
  if (shown === null || shown.answer.identity.population_id === before) return saved.content.bookmarks;
  return saved.content.bookmarks.filter((bookmark) => bookmark.identity.population_id !== before);
}

interface Echoed {
  request_id: string;
  query_revision: number;
  workspace_id: string;
}

function checkEcho<Answer extends Echoed>(request: Echoed, answer: Answer): SavingOutcome<Answer> {
  if (answer.request_id !== request.request_id || answer.query_revision !== request.query_revision) {
    return mismatch("The reply names a different request or query revision.");
  }
  if (answer.workspace_id !== request.workspace_id) return mismatch("The reply belongs to a different workspace.");
  return { ok: true, answer };
}

function checkSave(request: SaveInvestigationRequest, answer: SaveInvestigationAnswer): SavingOutcome<SaveInvestigationAnswer> {
  const echoed = checkEcho(request, answer);
  if (!echoed.ok) return echoed;
  const { content, investigation_id } = answer.revision;
  if (request.investigation_id !== null && investigation_id !== request.investigation_id) {
    return mismatch("The reply saved a different investigation.");
  }
  if (content.selection_identity.population_id !== request.selection_identity.population_id || content.name !== request.name) {
    return mismatch("The reply saved a different question.");
  }
  return { ok: true, answer };
}

function checkReopen(request: ReopenInvestigationRequest, answer: ReopenInvestigationAnswer): SavingOutcome<ReopenInvestigationAnswer> {
  const echoed = checkEcho(request, answer);
  if (!echoed.ok) return echoed;
  if (answer.revision.saved_revision_id !== request.saved_revision_id) return mismatch("The reply reopened a different revision.");
  return { ok: true, answer };
}

/** A refusal that names another request or revision does not answer this one. */
function checkProblem(request: { request_id: string; query_revision: number }, problem: SavingProblem): SavingOutcome<never> {
  if (problem.kind === "refusal") {
    const { request_id, query_revision } = problem.refusal;
    if ((request_id !== null && request_id !== request.request_id) || (query_revision !== null && query_revision !== request.query_revision)) {
      return mismatch("The refusal names a different request or query revision.");
    }
  }
  return { ok: false, problem };
}
