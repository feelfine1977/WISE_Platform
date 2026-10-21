import { browserStages, type StageStore } from "../stages/store";
import { fromPresentation, toPresentation } from "../stages/definitions";
import type { WorkspaceId } from "../generated/imports";
import { sameJson } from "../data/coordinator";
import type {
  EvidenceBookmark,
  ListSavedAnswer,
  ListSavedRequest,
  PresentationRecovery,
  RecoveryAnswer,
  SavedInvestigationContent,
  ReopenInvestigationAnswer,
  ReopenInvestigationRequest,
  RefreshInvestigationAnswer,
  RefreshInvestigationRequest,
  SaveInvestigationAnswer,
  SaveInvestigationRequest,
  SavedComparison,
  SavedComparisonParent,
  SavedInvestigationSummary,
  SavedOutcome,
  ScoreRunReference,
  Bpic19Pipeline,
  Bpic19PipelineManifest,
  Bpic19PreparedAssessmentReference,
} from "../generated/saving";
import {
  type ImportedInvestigationCoordinator,
  type ImportedInvestigationState,
  type InvestigationView,
  shownSelection,
} from "../imported/coordinator";
import type { SavingClient, SavingOutcome, SavingProblem } from "./client";
import type { Pin } from "../imported/coordinator";
import { pinNote } from "../pinned/pins";
import type { NoteFields } from "./notes";

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

/** A saved question applied to another reading: being asked for, refused, or shown with what changed, not yet saved. */
export type RefreshState =
  | { phase: "idle" }
  | { phase: "refreshing"; summary: SavedInvestigationSummary }
  | { phase: "failed"; summary: SavedInvestigationSummary; problem: SavingProblem }
  | { phase: "shown"; summary: SavedInvestigationSummary; answer: RefreshInvestigationAnswer };

/**
 * What the save form held when it was closed without saving: an unsaved draft of the question it was written for. It
 * is never a saved revision; a save that succeeds forgets it.
 */
export interface FormDraft {
  /** The question the draft was written for: the reading and the revision it would revise. */
  question: string;
  name: string;
  notes: NoteFields;
}

export interface SavingState {
  list: SavedListState;
  reopen: ReopenState;
  save: SaveState;
  refresh?: RefreshState;
  form?: FormDraft | null;
}

/** An immutable server-verified result, separate from the save form's status. */
export type VerifiedSavedExportReceipt = Readonly<Pick<SaveInvestigationAnswer,
  "workspace_id" | "revision" | "bpic19_outputs" | "bpic19_prepared_outputs">>;

/** The part of the comparison view that saving needs: the comparison shown on a reading, in its saved form. */
export interface ComparisonSource {
  savedComparisonFor(workspaceId: WorkspaceId, identity: SaveInvestigationRequest["base_identity"]): SavedComparison | null;
  /** Shows the comparison of a reopened investigation again, or forgets one that was waiting when there is none. */
  restore(workspaceId: WorkspaceId, identity: SaveInvestigationRequest["base_identity"], saved: SavedComparison | null,
    described?: SavedComparisonParent | null, outcome?: SavedOutcome | null): void;
  /** How the frozen parent of the comparison shown was taken, in its saved form. */
  savedParentFor?(workspaceId: WorkspaceId, identity: SaveInvestigationRequest["base_identity"]): SavedComparisonParent | null;
  /** The outcome named beside the comparison shown, in its saved form. */
  savedOutcomeFor?(workspaceId: WorkspaceId, identity: SaveInvestigationRequest["base_identity"]): SavedOutcome | null;
}

/** The part of the expectation view that saving needs: the score run shown, as a saved investigation refers to it. */
export interface ScoreSource {
  savedReference(): ScoreRunReference | null;
  /** Shows the score run of a reopened investigation again by reading it, or none when it refers to none. */
  restore(reference: ScoreRunReference | null): void;
}

export interface PipelineSource {
  readyForSave(): boolean;
  savedPipeline(): Bpic19Pipeline | null;
}

/** Declared assessment references use their own basis, never an incident population. */
export interface PreparedAssessmentSource {
  readyForSave(): boolean;
  savedPreparedAssessments(): SaveInvestigationRequest["bpic19_prepared_assessments"];
  restore(workspaceId: string, references: readonly Bpic19PreparedAssessmentReference[]): void;
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
      /** Pins made in a population that is no longer one of this question's; the revision they were saved in keeps them. */
      leftBehind: number;
      /** The pins saved with the question, as their witnesses. */
      pins: Pin[];
    };

const initialState: SavingState = { list: { phase: "idle" }, reopen: { phase: "idle" }, save: { phase: "idle" } };

function metadataRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const unreachable: SavingOutcome<never> = { ok: false, problem: { kind: "unreachable" } };

/** The revision of the population shown, or 0 while none is shown. */
function populationRevision(state: ImportedInvestigationState): number {
  return state.population.phase === "ready" ? state.population.revision : 0;
}

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
  /** Ends the wait for a reopened investigation to be shown, while such a wait is on. */
  private awaited: (() => void) | null = null;
  private nativeLabels: { revisionId: string; labels: Readonly<Record<string, string>> } | null = null;
  private exportReceipt: VerifiedSavedExportReceipt | null = null;

  constructor(
    private readonly client: SavingClient,
    private readonly investigation: ImportedInvestigationCoordinator,
    /** Where a comparison made on screen is found, so that saving the investigation keeps it. */
    private readonly comparisons?: ComparisonSource,
    /** Where the score run shown is found, so that saving the investigation refers to it. */
    private readonly scores?: ScoreSource,
    private readonly pipeline?: PipelineSource,
    private readonly prepared?: PreparedAssessmentSource,
    /** The stages of each reading, which an investigation is saved and reopened with. */
    private readonly stages: StageStore = browserStages,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): SavingState => this.state;

  /** Export only the verified saved revision still shown on this exact reading. */
  verifiedExportReceipt(): VerifiedSavedExportReceipt | null {
    const receipt = this.exportReceipt;
    if (!receipt || (!receipt.bpic19_outputs && !receipt.bpic19_prepared_outputs)) return null;
    const state = this.investigation.getState();
    const { population, selection, saved } = state;
    const target = state.replacement?.asked.target ?? (population.phase === "idle" ? null : population.target);
    if (target && (target.workspaceId !== receipt.workspace_id ||
        target.preparationId !== receipt.revision.content.base_identity.preparation_id)) {
      this.exportReceipt = null;
      return null;
    }
    if (state.replacement === null && population.phase === "ready" &&
        (population.answer.workspace_id !== receipt.workspace_id ||
         !sameIdentity(population.answer.identity, receipt.revision.content.base_identity))) {
      this.exportReceipt = null;
      return null;
    }
    if (this.current.has("save") || this.current.has("reopen") || state.replacement !== null ||
        population.phase !== "ready" || selection.phase !== "ready" || !saved ||
        saved.revisionId !== receipt.revision.saved_revision_id ||
        !sameJson(saved.content, receipt.revision.content)) return null;
    const shown = shownSelection(selection);
    if (!shown || !sameIdentity(shown.answer.identity, receipt.revision.content.selection_identity)) return null;
    if (this.pipeline && (!this.pipeline.readyForSave() ||
        !sameJson(this.pipeline.savedPipeline(), receipt.revision.content.bpic19_pipeline ?? null))) return null;
    if (this.prepared && (!this.prepared.readyForSave() ||
        !sameJson(this.prepared.savedPreparedAssessments() ?? null, receipt.revision.content.bpic19_prepared_assessments ?? null))) return null;
    return receipt;
  }

  private rememberExportReceipt(answer: SaveInvestigationAnswer | ReopenInvestigationAnswer): void {
    this.exportReceipt = answer.bpic19_outputs || answer.bpic19_prepared_outputs ? structuredClone({
      workspace_id: answer.workspace_id, revision: answer.revision,
      ...(answer.bpic19_outputs ? { bpic19_outputs: answer.bpic19_outputs } : {}),
      ...(answer.bpic19_prepared_outputs ? { bpic19_prepared_outputs: answer.bpic19_prepared_outputs } : {}),
    }) : null;
  }

  /** Presentation labels come only from a verified immutable save/reopen answer. */
  nativeRunLabels(revisionId?: string): Readonly<Record<string, string>> {
    const stored = this.nativeLabels;
    return stored && revisionId === stored.revisionId ? stored.labels : {};
  }

  private rememberNativeLabels(revisionId: string, manifest?: Bpic19PipelineManifest): void {
    const labels: Record<string, string> = {};
    for (const entry of manifest?.outputs ?? []) {
      const output = entry.output, report = output.report;
      if (entry.operation !== "bpic19_score" || typeof output.run_id !== "string" || !metadataRecord(report)) continue;
      const settings = report.settings;
      if (!metadataRecord(settings) || typeof settings.view !== "string" || !["flat", "layer_balanced"].includes(String(settings.mode)) || typeof settings.gamma !== "number" || !Number.isFinite(settings.gamma) || typeof report.profile_id !== "string") continue;
      const profile = report.profile_id.startsWith("bpic19.notebook") ? "Historical notebook" : report.profile_id.startsWith("bpic19.paper") ? "WISE paper" : null;
      if (profile === null) continue;
      let multiplier = "Multiplier not retained";
      if (settings.volume === "cases") multiplier = "Scored item count";
      else if (settings.volume === "exposure") {
        const calibration = metadataRecord(report.exposure_calibration) ? report.exposure_calibration : null;
        const definition = metadataRecord(output.definition) ? output.definition : null;
        const frozenSettings = metadataRecord(definition?.settings) ? definition.settings : null;
        const policy = frozenSettings?.exposure_policy ?? calibration?.policy ?? settings.exposure_policy;
        const recipes: Readonly<Record<string, string>> = {creation_value: "creation value", creation_unique_value: "unique finite creation value",
          creation_unique_event: "unique creation event value", max_absolute_p95: "maximum absolute value · frozen P95"};
        const recipe = typeof policy === "string" ? recipes[policy] ?? "Unsupported stored recipe" : "Recipe not retained";
        const unit = calibration?.unit_provenance === "explicit_raw_measures_definition.v1" && typeof calibration.source_unit === "string" && calibration.source_unit.trim()
          ? `reviewed source unit ${calibration.source_unit.trim()}` : "generic source units";
        multiplier = `Exposure · ${recipe} · ${unit}`;
      }
      labels[output.run_id] = `${profile} · ${settings.view} · ${settings.mode === "flat" ? "flat" : "layer balanced"} · gamma ${settings.gamma} · ${multiplier}`;
    }
    this.nativeLabels = { revisionId, labels };
  }

  /** What saving the question shown now would hold, from the investigation's state. */
  draft(investigation: ImportedInvestigationState): SaveDraft {
    const { population, selection, saved } = investigation;
    if (this.prepared && !this.prepared.readyForSave()) return { ready: false, reason: "Review, run and retain the declared assessment changes, or discard them before saving." };
    if (this.pipeline && !this.pipeline.readyForSave()) return { ready: false, reason: "Review the changed BPIC19 definitions or finish the pending analysis before saving." };
    if (population.phase !== "ready") return { ready: false, reason: "The incidents are not open yet." };
    if (investigation.replacement?.phase === "running") return { ready: false, reason: "Saving is possible once the other incidents asked for are open." };
    const shown = shownSelection(selection);
    if (selection.phase !== "ready" || shown === null) {
      return { ready: false, reason: "Saving is possible once the incidents of the current steps are selected." };
    }
    const savable = savablePins(investigation);
    return {
      ready: true,
      revises: saved !== null,
      name: saved?.content.name ?? population.answer.source.filename,
      notes: saved?.content.notes ?? "",
      leftBehind: investigation.pins.length - savable.length,
      pins: savable,
    };
  }

  /** Saves the question shown under a name and a note; a question saved before gets a new revision. */
  save(name: string, notes: string, view: InvestigationView): void {
    if (this.prepared && !this.prepared.readyForSave()) return;
    if (this.pipeline && !this.pipeline.readyForSave()) return;
    const investigation = this.investigation.getState();
    const { population, selection, saved, parentCaseIds } = investigation;
    const shown = shownSelection(selection);
    if (investigation.replacement?.phase === "running" || population.phase !== "ready" || selection.phase !== "ready" || shown === null || name.trim() === "") return;
    const { requestId, revision, signal } = this.issue("save", "save");
    // The stages of this reading are saved with the investigation, bound to its preparation; a reading without stages saves none.
    const preparationId = population.answer.identity.preparation_id;
    const stages = this.stages.stateOf({ workspaceId: population.answer.workspace_id, preparationId }).definitions;
    const presentation: PresentationRecovery = {
      active_view: view === "map" ? "process_map" : "incidents",
      table_sorts: [],
      flow_artifact_sha256: null,
      graph_positions: null,
      ...(stages.stages.length > 0 ? { stages: toPresentation(stages, preparationId) } : {}),
    };
    // What the saved revision holds is carried only on its own reading: a question applied to another reading is compared and scored there anew.
    const sameReading = saved !== null && sameIdentity(saved.content.base_identity, population.answer.identity);
    const scoreReference = this.scores?.savedReference() ?? (sameReading ? saved.content.score_run_ref : null) ?? null;
    const pipeline = this.pipeline?.savedPipeline() ?? (saved && sameIdentity(saved.content.selection_identity, shown.answer.identity) ? saved.content.bpic19_pipeline : null);
    const comparisonParent = this.comparisons?.savedParentFor?.(population.answer.workspace_id, population.answer.identity) ?? null;
    const outcome = this.comparisons?.savedOutcomeFor?.(population.answer.workspace_id, population.answer.identity) ?? null;
    const prepared = this.prepared ? this.prepared.savedPreparedAssessments() : saved?.content.bpic19_prepared_assessments;
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
        (sameReading ? saved.content.comparison : null) ??
        null,
      notes,
      // The pins of this question are its witnesses, with their roles and words; pins made under other steps stay out.
      bookmarks: savablePins(investigation).map((pin): EvidenceBookmark => ({ label: pin.label, identity: pin.identity, case_id: pin.caseId, row_ids: [...pin.rowIds], note: pinNote(pin) })),
      presentation_state: presentation,
      // The score run shown on this reading is referred to; without one, a run the saved investigation
      // refers to stays referred to until it is taken away on purpose.
      ...(scoreReference ? { score_run_ref: scoreReference } : {}),
      ...(pipeline ? { bpic19_pipeline: pipeline } : {}),
      ...(prepared ? { bpic19_prepared_assessments: prepared } : {}),
      ...(comparisonParent ? { comparison_parent: comparisonParent } : {}),
      ...(outcome ? { outcome } : {}),
    };
    // A new investigation names neither an investigation nor the revision it replaces; a new revision names both.
    const request: SaveInvestigationRequest = saved
      ? { ...question, investigation_id: saved.investigationId, expected_revision_id: saved.revisionId }
      : { ...question, investigation_id: null, expected_revision_id: null };
    this.exportReceipt = null;
    this.publish({ ...this.state, save: { phase: "saving", name } });
    this.client.save(request, signal).then(
      (outcome) => this.receiveSave(request, outcome),
      () => this.receiveSave(request, unreachable),
    );
  }

  /** What a save of the question shown would hold beside its steps and notes: the comparison, its parent's description and the outcome. */
  heldWith(investigation: ImportedInvestigationState): { comparison: SavedComparison | null; parent: SavedComparisonParent | null; outcome: SavedOutcome | null; scored: boolean } {
    const { population, saved } = investigation;
    if (population.phase !== "ready") return { comparison: null, parent: null, outcome: null, scored: false };
    const { workspace_id: workspaceId, identity } = population.answer;
    return {
      comparison: this.comparisons?.savedComparisonFor(workspaceId, identity) ?? (saved && sameIdentity(saved.content.base_identity, identity) ? saved.content.comparison : null) ?? null,
      parent: this.comparisons?.savedParentFor?.(workspaceId, identity) ?? null,
      outcome: this.comparisons?.savedOutcomeFor?.(workspaceId, identity) ?? null,
      scored: (this.scores?.savedReference() ?? (saved && sameIdentity(saved.content.base_identity, identity) ? saved.content.score_run_ref : null) ?? null) !== null,
    };
  }

  /** Keeps what the save form holds when it is closed without saving: an unsaved draft, shown as one when the form opens again. */
  keepForm(form: FormDraft | null): void {
    this.publish({ ...this.state, form });
  }

  /**
   * Applies a saved question to another reading, for example of a refreshed source: its steps and parent there, and what
   * changed, shown as a question not yet saved. Saving it adds a revision to the same investigation; the earlier one stays.
   */
  refresh(summary: SavedInvestigationSummary, workspaceId: WorkspaceId, preparationId: string): Promise<boolean> {
    const client = this.client.refresh?.bind(this.client);
    if (!client) return Promise.resolve(false);
    this.forgetAwaited();
    const { requestId, revision, signal } = this.issue("refresh", "refresh");
    const request: RefreshInvestigationRequest = {
      schema_version: 1, message_type: "refresh_investigation_request", request_id: requestId, query_revision: revision, workspace_id: workspaceId,
      saved_revision_id: summary.latest_revision_id, preparation_id: preparationId,
    };
    this.publish({ ...this.state, refresh: { phase: "refreshing", summary } });
    return client(request, signal).then(
      (outcome) => this.receiveRefresh(request, summary, outcome),
      () => this.receiveRefresh(request, summary, unreachable),
    );
  }

  private receiveRefresh(request: RefreshInvestigationRequest, summary: SavedInvestigationSummary, outcome: SavingOutcome<RefreshInvestigationAnswer>): boolean {
    if (!this.isCurrent("refresh", request.request_id)) return false;
    this.current.delete("refresh");
    const checked = outcome.ok ? checkEcho(request, outcome.answer) : checkProblem(request, outcome.problem);
    if (!checked.ok || checked.answer.preparation_id !== request.preparation_id || checked.answer.revision.saved_revision_id !== request.saved_revision_id) {
      this.publish({ ...this.state, refresh: { phase: "failed", summary, problem: checked.ok ? { kind: "unsupported_reply", detail: "The reply refreshed another question." } : checked.problem } });
      return false;
    }
    const answer = checked.answer;
    const { revision, restored_selection } = answer;
    const { content } = revision;
    const shownBefore = populationRevision(this.investigation.getState());
    // The saved question on the new reading, bound to the revision it refreshes: saving it adds the next revision.
    this.investigation.restore({
      target: { workspaceId: request.workspace_id, preparationId: request.preparation_id },
      steps: content.selection_recipe.predicates,
      parentCaseIds: restored_selection.parent.case_ids,
      selectionIdentity: restored_selection.identity,
      binding: { investigationId: revision.investigation_id, revisionId: revision.saved_revision_id, content },
      view: "incidents",
      refreshed: true,
    });
    this.forgetAwaited();
    const hand = () => this.comparisons?.restore(request.workspace_id, content.base_identity, null);
    const accepted = () => {
      const { population, replacement } = this.investigation.getState();
      return replacement === null && population.phase === "ready" && population.revision > shownBefore && population.answer.identity.preparation_id === request.preparation_id;
    };
    if (accepted()) hand();
    else {
      const unsubscribe = this.investigation.subscribe(() => {
        if (!accepted()) return;
        this.forgetAwaited();
        hand();
      });
      this.awaited = unsubscribe;
    }
    this.exportReceipt = null;
    this.publish({ ...this.state, refresh: { phase: "shown", summary, answer }, reopen: { phase: "idle" }, save: { phase: "idle" } });
    return true;
  }

  /** Forgets the review of a refreshed question, for example once it is saved or another question is opened. */
  clearRefresh(): void {
    this.cancel("refresh");
    if (this.state.refresh && this.state.refresh.phase !== "idle") this.publish({ ...this.state, refresh: { phase: "idle" } });
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
    this.forgetAwaited();
    const { requestId, revision, signal } = this.issue("reopen", "reopen");
    this.exportReceipt = null;
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
    this.forgetAwaited();
    this.exportReceipt = null;
  }

  /**
   * Hands the comparison and the score run of a reopened investigation to their views once the
   * investigation shows that saved revision on its own reading, and not before: while the reopened
   * question is still being opened, or if opening it fails, what the views show stays as it is.
   * A later reopening, or stopping, cancels the wait.
   */
  private restoreWhenAccepted(
    workspaceId: WorkspaceId,
    revision: ReopenInvestigationAnswer["revision"],
    shownBefore: number,
  ): void {
    this.forgetAwaited();
    const { content } = revision;
    const accepted = (): boolean => {
      const state = this.investigation.getState();
      const { population, saved } = state;
      // The question shown before the reopening can already be this saved revision on this reading.
      // It is not the reopened one: that is a population answered later, with no other question
      // still opening or failed in its place.
      return (
        state.replacement === null &&
        saved?.revisionId === revision.saved_revision_id &&
        population.phase === "ready" &&
        population.revision > shownBefore &&
        population.answer.workspace_id === workspaceId &&
        sameIdentity(population.answer.identity, content.base_identity)
      );
    };
    const hand = (): void => {
      this.comparisons?.restore(workspaceId, content.base_identity, content.comparison, content.comparison_parent ?? null, content.outcome ?? null);
      this.scores?.restore(content.score_run_ref ?? null);
      this.prepared?.restore(workspaceId, content.bpic19_prepared_assessments ?? []);
    };
    if (accepted()) {
      hand();
      return;
    }
    const unsubscribe = this.investigation.subscribe(() => {
      if (!accepted()) return;
      this.forgetAwaited();
      hand();
    });
    this.awaited = unsubscribe;
  }

  private forgetAwaited(): void {
    this.awaited?.();
    this.awaited = null;
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
    this.rememberNativeLabels(revision.saved_revision_id, checked.answer.bpic19_outputs);
    this.rememberExportReceipt(checked.answer);
    this.publish({ ...this.state, save: { phase: "saved", answer: checked.answer }, form: null, refresh: { phase: "idle" } });
  }

  /** Whether the investigation still shows the question a save request was made for. */
  private stillShows(request: SaveInvestigationRequest): boolean {
    const { population, selection, saved } = this.investigation.getState();
    const shown = shownSelection(selection);
    const currentPipeline = this.pipeline?.savedPipeline() ?? (saved && shown && sameIdentity(saved.content.selection_identity, shown.answer.identity) ? saved.content.bpic19_pipeline : null);
    return (
      (!this.pipeline || (this.pipeline.readyForSave() && sameJson(request.bpic19_pipeline ?? null, currentPipeline ?? null))) &&
      (!this.prepared || (this.prepared.readyForSave() && sameJson(request.bpic19_prepared_assessments ?? null, this.prepared.savedPreparedAssessments() ?? null))) &&
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
    this.rememberNativeLabels(revision.saved_revision_id, checked.answer.bpic19_outputs);
    const { content } = revision;
    // The population shown before this reopening: only a later one can be the reopened question.
    const shownBefore = populationRevision(this.investigation.getState());
    this.investigation.restore({
      target: { workspaceId: request.workspace_id, preparationId: content.base_identity.preparation_id },
      steps: content.selection_recipe.predicates,
      parentCaseIds: content.selection_recipe.parent_case_ids,
      selectionIdentity: restored_selection.identity,
      binding: { investigationId: revision.investigation_id, revisionId: revision.saved_revision_id, content },
      view: recovery.presentation_state?.active_view === "process_map" ? "map" : "incidents",
    });
    this.restoreStages(request.workspace_id, content, recovery);
    this.restoreWhenAccepted(request.workspace_id, revision, shownBefore);
    this.rememberExportReceipt(checked.answer);
    // A draft written for this investigation, for example before a conflict, stays for its latest revision.
    const form = this.state.form && this.state.form.question === revision.investigation_id ? this.state.form : null;
    this.publish({ ...this.state, reopen: { phase: "idle" }, save: { phase: "idle" }, refresh: { phase: "idle" }, form });
    return true;
  }

  /**
   * The stages saved with a reopened investigation are shown again for its reading and said to be. Stages the local
   * service left out, or that name another preparation than the investigation's, are not applied, and that is said too.
   */
  private restoreStages(workspaceId: string, content: SavedInvestigationContent, recovery: RecoveryAnswer): void {
    const reading = { workspaceId, preparationId: content.base_identity.preparation_id };
    const left = recovery.warnings.find((warning) => warning.code === "stages_not_applied");
    const saved = recovery.presentation_state?.stages;
    if (left) this.stages.restore(reading, null, { kind: "not_applied", investigation: content.name, message: left.message });
    else if (saved && saved.preparation_id !== reading.preparationId) {
      this.stages.restore(reading, null, { kind: "not_applied", investigation: content.name,
        message: "The stages saved with this investigation were defined for another reading of the source; they were not applied." });
    } else if (saved) this.stages.restore(reading, fromPresentation(saved), { kind: "restored", investigation: content.name });
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
 * The pins of the question shown that a saved revision can keep: those read in the selection shown, in its parent or in
 * the population. A pin made under other steps names a population of no revision of this question and stays out; the
 * revision it was saved in, if any, keeps it.
 */
function savablePins(investigation: ImportedInvestigationState): Pin[] {
  const shown = shownSelection(investigation.selection);
  if (shown === null || investigation.population.phase !== "ready") return [];
  const held = new Set([shown.answer.identity.population_id, shown.answer.parent_identity.population_id, investigation.population.answer.identity.population_id]);
  return investigation.pins.filter((pin) => held.has(pin.identity.population_id));
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

function preparedOutputsMatch(answer: SaveInvestigationAnswer | ReopenInvestigationAnswer): boolean {
  const references = answer.revision.content.bpic19_prepared_assessments;
  const manifest = answer.bpic19_prepared_outputs;
  if (!references) return manifest === undefined;
  return manifest !== undefined && sameJson(manifest.references, references) &&
    references.every(reference => reference.input_id === manifest.input_id) &&
    new Set(references.map(reference => reference.view)).size === references.length;
}

function checkSave(request: SaveInvestigationRequest, answer: SaveInvestigationAnswer): SavingOutcome<SaveInvestigationAnswer> {
  const echoed = checkEcho(request, answer);
  if (!echoed.ok) return echoed;
  const { content, investigation_id } = answer.revision;
  if (request.investigation_id !== null && investigation_id !== request.investigation_id) {
    return mismatch("The reply saved a different investigation.");
  }
  if (!sameJson(content.bpic19_prepared_assessments ?? null, request.bpic19_prepared_assessments ?? null) ||
      !preparedOutputsMatch(answer)) {
    return mismatch("The reply saved different declared prepared assessments or omitted their verified stored outputs.");
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
  if (!preparedOutputsMatch(answer)) return mismatch("The reopened prepared outputs do not match their exact retained input and references.");
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
