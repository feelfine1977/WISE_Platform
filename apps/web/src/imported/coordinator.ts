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
import type { EvidenceBookmark, SavedInvestigationContent } from "../generated/saving";
import { readPinNote } from "../pinned/pins";
import type { SelectionClient, SelectionOutcome, SelectionProblem } from "../map/client";
import { backTo, noSteps, redone, type StepHistory, type Steps, undone, withoutStep, withoutSteps, withStep } from "../map/steps";
import { AwaitedRequest, type Replacement } from "../replacement/replacement";
import { httpPopulationViewClient, type PopulationViewClient, type ViewOutcome, type ViewProblem } from "../views/client";
import type { OpeningContextAnswer, OpeningContextRequest, VariantId, VariantsAnswer, VariantsRequest } from "../views/messages";

/** The preparation an imported investigation is opened on. */
export interface PreparationTarget {
  workspaceId: WorkspaceId;
  preparationId: PreparationId;
  /** The name of the source file, where the caller knows it; it names the preparation until its answer arrives. */
  sourceName?: string;
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
  /** Whether the saved question is applied to another reading than its own: its pins stay with the revision they were saved in. */
  refreshed?: boolean;
}

/** A question asked for: the population of a preparation, or a saved investigation to open again. */
export interface AskedQuestion {
  target: PreparationTarget;
  restoration: Restoration | null;
  /** The steps a reading is opened with when it is taken up where it was left; a saved investigation brings its own. */
  steps?: Steps;
}

export type ImportedPopulationState =
  | { phase: "idle" }
  | { phase: "loading"; revision: number; target: PreparationTarget }
  | { phase: "ready"; revision: number; target: PreparationTarget; answer: ImportedPopulationAnswer }
  | { phase: "failed"; revision: number; target: PreparationTarget; problem: ImportProblem };

/**
 * Where an incident was opened from: the incidents the selection keeps, those it removes (read in the selection's parent), or
 * a pin, which keeps the population it was pinned in whatever the selection becomes.
 */
export type CaseSide = "kept" | "removed" | "pinned";

/** The population an incident's history is asked in, and where it was opened from; kept when absent. */
export interface CaseHandle {
  side?: CaseSide;
  /** The population of a pinned incident; the others are asked in the selection shown or its parent. */
  identity?: AnswerIdentity;
  /** The pin an incident was opened from. */
  pinId?: number;
}

export type ImportedCaseState =
  | { phase: "closed" }
  | ({ phase: "loading"; caseId: CaseId } & CaseHandle)
  | ({
      phase: "ready";
      caseId: CaseId;
      answer: ImportedCaseEvidenceAnswer;
      /** A pinned history that could not be read when asked for after this one; this history stays as it was read. */
      refusal?: { caseId: CaseId; problem: ImportProblem };
    } & CaseHandle)
  | ({ phase: "failed"; caseId: CaseId; problem: ImportProblem } & CaseHandle);

/** The analyst's reading of a pinned history; WISE does not decide it. */
export type PinRole = "supporting" | "contrary";

/** What the analyst writes on a pin: a label, and optionally an observation, a limitation and a next check. */
export interface PinWords {
  label: string;
  observation: string;
  limitation: string;
  nextCheck: string;
}

/**
 * A complete history pinned with the exact population it was opened in (its evidence handle), the question it was pinned
 * under and the analyst's role and words. A contrary incident removed by the selection keeps the identity of the
 * selection's parent: it is asked there, never relabelled from the kept incidents.
 */
export interface Pin extends PinWords {
  id: number;
  role: PinRole;
  caseId: CaseId;
  side: "kept" | "removed";
  identity: AnswerIdentity;
  rowIds: string[];
  /** The selection shown when the history was pinned: its identity, steps and supports. */
  question: { populationId: string; steps: SelectionPredicate[]; kept: number; removed: number; parent: number };
}

export type PinEvidence = { ok: true; answer: ImportedCaseEvidenceAnswer } | { ok: false; problem: ImportProblem };

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
/** What one more step would keep, counted by the service without changing the selection shown. */
export type StepPreview =
  | { ok: true; parent: number; kept: number; removed: number; unevaluable: number; keptIds: string[] }
  | { ok: false; problem: SelectionProblem };

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
  /** The histories pinned in this question, in the order they were pinned. */
  pins: Pin[];
  /** The map of every incident of the parent, from which the map's arrangement is computed once. */
  parentGraph: SuppliedGraph | null;
  /** The saved investigation this question was reopened from or saved as; null until it is saved. */
  saved: SavedBinding | null;
  /** The view a reopened investigation was saved in; null for a question opened from the Data area. */
  restoredView: InvestigationView | null;
  /** The incidents the selection is made of: every incident of the population (null), or the saved parent. */
  parentCaseIds: CaseId[] | null;
  /**
   * Another question asked for in place of the one shown, while it opens or after it failed; null
   * when there is none. Everything above stays the question shown until the new population arrives.
   */
  replacement: Replacement<AskedQuestion, ImportProblem> | null;
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
  pins: [],
  parentGraph: null,
  saved: null,
  restoredView: null,
  parentCaseIds: null,
  replacement: null,
};

/**
 * Holds the query revision of the investigation of one imported preparation and is the only place
 * where its replies are published: the population, the selection of its incidents with the map of
 * the kept ones, and the complete history of one kept incident. Opening the population and every
 * change of the selection start a new revision. A reply whose revision or request is no longer
 * current is dropped, whether it is an answer, a refusal or a failure.
 *
 * Once a population is shown, opening another one keeps the question shown in full, with the
 * requests it has under way, until the new population arrives; a failure is shown beside it.
 */
export class ImportedInvestigationCoordinator {
  private state: ImportedInvestigationState = initialState;
  /** The query revision of the question shown. */
  private revision = 0;
  /** The last revision issued, to the question shown or to the one asked for in its place. */
  private issued = 0;
  private caseRequestSequence = 0;
  private pinSequence = 0;
  /** The bookmarks of a reopened investigation, turned into pins once its selection is shown again. */
  private pendingBookmarks: EvidenceBookmark[] | null = null;
  private viewRequestSequence = 0;
  private currentCaseRequestId: string | null = null;
  /** The handle of the history last asked for, published with its answer. */
  private caseHandle: CaseHandle = {};
  /** The history read before a pinned one was asked for, kept if the pinned one cannot be read. */
  private priorHistory: Extract<ImportedCaseState, { phase: "ready" }> | null = null;
  private readonly populationRequest = new AwaitedRequest();
  /** The question shown, or being opened when none is shown yet; a retry asks for it again. */
  private asked: AskedQuestion | null = null;
  private caseRequest: AbortController | null = null;
  private selectionRequest: AbortController | null = null;
  private parentGraphRequest: AbortController | null = null;
  private viewTarget: ViewTarget | null = null;
  /** The query revision the views of the target were first asked under; a retry asks under it again. */
  private viewRevision = 0;
  private openingRequest: Pending | null = null;
  private variantsRequest: Pending | null = null;
  /** The steps the population is selected by once it is open; a reopened investigation's saved steps. */
  private openingSteps: Steps = [];
  /** The steps, with their undo and redo, that the selection shown was answered under. */
  private shownHistory: StepHistory = noSteps;
  /** The identity the first selection of a reopened investigation must have, until it is answered. */
  private restoredIdentity: AnswerIdentity | null = null;
  /** The identity each list of steps was answered with under the population shown; undo and redo must find it again. */
  private answeredIdentities = new Map<string, AnswerIdentity>();
  /** The identity the selection being asked for must have, and what is said when it does not; set by undo and redo. */
  private expectedIdentity: AnswerIdentity | null = null;
  private previews = 0;
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

  /** Opens the incidents of a reading, with the steps it was left with when it is taken up again. */
  open(target: PreparationTarget, steps: Steps = []): void {
    this.openWith(target, null, steps);
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

  private nextRevision(): number {
    this.issued += 1;
    return this.issued;
  }

  private openWith(target: PreparationTarget, restoration: Restoration | null, steps: Steps = []): void {
    const revision = this.nextRevision();
    this.pendingBookmarks = restoration && !restoration.refreshed ? [...restoration.binding.content.bookmarks] : null;
    const asked: AskedQuestion = { target, restoration, steps };
    const request: OpenPopulationRequest = {
      schema_version: 1,
      message_type: "open_population_request",
      request_id: `population-${revision}`,
      query_revision: revision,
      workspace_id: target.workspaceId,
      preparation_id: target.preparationId,
    };
    const signal = this.populationRequest.start(revision);
    if (this.state.population.phase === "ready") {
      this.publish({ ...this.state, replacement: { phase: "running", revision, asked } });
    } else {
      this.leaveQuestion(revision, asked);
      this.publish({ ...initialState, ...openingOf(restoration), population: { phase: "loading", revision, target } });
    }
    this.client.openPopulation(request, signal).then(
      (outcome) => this.receivePopulation(request, asked, outcome),
      () => this.receivePopulation(request, asked, unreachable),
    );
  }

  /** Abandons every request of the question shown and takes up the one asked for under its revision. */
  private leaveQuestion(revision: number, asked: AskedQuestion): void {
    this.revision = revision;
    this.cancelSelectionRequest();
    this.cancelCaseRequest();
    this.cancelViewRequests();
    this.asked = asked;
    this.openingSteps = asked.restoration ? asked.restoration.steps : (asked.steps ?? []);
    this.restoredIdentity = asked.restoration ? asked.restoration.selectionIdentity : null;
  }

  retryPopulation(): void {
    const { population, replacement } = this.state;
    const asked = replacement?.phase === "failed" ? replacement.asked : population.phase === "failed" ? this.asked : null;
    if (asked) this.openWith(asked.target, asked.restoration, asked.steps);
  }

  /** Gives up a failed replacement: the question shown stays as it is. */
  stay(): void {
    if (this.state.replacement?.phase === "failed") this.publish({ ...this.state, replacement: null });
  }

  /** Whether another question is opening in place of the one shown, so that nothing new is asked of it. */
  private replacing(): boolean {
    return this.state.replacement?.phase === "running";
  }

  /**
   * Opens the complete history of an incident of the selection shown, or of the population before one is; an incident the
   * selection removes is asked in the selection's parent, whose identity it is then read under.
   */
  openCase(caseId: CaseId, side: "kept" | "removed" = "kept"): void {
    if (!this.replacing()) this.requestCase(caseId, side === "removed" ? { side } : {});
  }

  /** Opens a pinned history in the population it was pinned in, whatever the selection shown now. */
  openPin(pinId: number): void {
    const pin = this.state.pins.find((candidate) => candidate.id === pinId);
    if (pin && !this.replacing()) this.requestCase(pin.caseId, { side: "pinned", identity: pin.identity, pinId });
  }

  /** The handle an incident is asked under: the pin's population, the selection's parent for a removed incident, or the selection shown. */
  private handleIdentity(handle: CaseHandle): AnswerIdentity | null {
    const population = this.state.population;
    if (population.phase !== "ready") return null;
    if (handle.identity) return handle.identity;
    const shown = shownSelection(this.state.selection);
    if (handle.side === "removed") return shown ? shown.answer.parent_identity : null;
    return shown ? shown.answer.identity : population.answer.identity;
  }

  private requestCase(caseId: CaseId, handle: CaseHandle = {}): void {
    const population = this.state.population;
    const identity = this.handleIdentity(handle);
    if (population.phase !== "ready" || identity === null) return;
    this.cancelCaseRequest();
    this.caseRequestSequence += 1;
    const request: ImportedCaseEvidenceRequest = {
      schema_version: 1,
      message_type: "imported_case_evidence_request",
      request_id: `case-${this.revision}-${this.caseRequestSequence}`,
      query_revision: this.revision,
      workspace_id: population.answer.workspace_id,
      identity,
      case_id: caseId,
    };
    this.currentCaseRequestId = request.request_id;
    this.caseHandle = { ...handle, identity: handle.side === "pinned" ? identity : handle.identity };
    // A pinned history that cannot be read leaves the history read before it as it was.
    const before = this.state.inspected;
    this.priorHistory = handle.side === "pinned" && before.phase === "ready" ? { ...before, refusal: undefined } : null;
    this.publish({ ...this.state, inspected: { phase: "loading", caseId, ...handleOf(handle) } });
    const controller = new AbortController();
    this.caseRequest = controller;
    this.client.caseEvidence(request, controller.signal).then(
      (outcome) => this.receiveCase(request, outcome),
      () => this.receiveCase(request, unreachable),
    );
  }

  retryCase(): void {
    const inspected = this.state.inspected;
    if (inspected.phase === "failed" && !this.replacing()) this.requestCase(inspected.caseId, handleOf(inspected));
  }

  /**
   * Pins the history open in the inspector with the population it was read in, the question shown and the analyst's role
   * and words; nothing is pinned while no history is read. Returns the pin.
   */
  pin(role: PinRole, words: PinWords): Pin | null {
    const inspected = this.state.inspected;
    const shown = shownSelection(this.state.selection);
    if (inspected.phase !== "ready" || inspected.side === "pinned" || shown === null) return null;
    this.pinSequence += 1;
    const answer = inspected.answer;
    const pin: Pin = {
      id: this.pinSequence,
      role,
      caseId: inspected.caseId,
      side: inspected.side === "removed" ? "removed" : "kept",
      identity: answer.identity,
      rowIds: answer.records.map((record) => record.row_id),
      question: {
        populationId: shown.answer.identity.population_id,
        steps: shown.answer.predicate_results.map((result) => result.predicate),
        kept: shown.answer.kept.case_count,
        removed: shown.answer.removed.case_count,
        parent: shown.answer.parent.case_count,
      },
      label: words.label.trim() === "" ? `Incident ${inspected.caseId}` : words.label.trim(),
      observation: words.observation.trim(),
      limitation: words.limitation.trim(),
      nextCheck: words.nextCheck.trim(),
    };
    this.publish({ ...this.state, pins: [...this.state.pins, pin] });
    return pin;
  }

  /** A saved bookmark as a pin of the reopened question: its role and words read from its note, its side from its population. */
  private pinOf(bookmark: EvidenceBookmark, selected: SelectionAnswer, steps: readonly SelectionPredicate[]): Pin {
    this.pinSequence += 1;
    const words = readPinNote(bookmark.note);
    return {
      id: this.pinSequence,
      ...words,
      caseId: bookmark.case_id,
      side: bookmark.identity.population_id === selected.identity.population_id ? "kept" : "removed",
      identity: bookmark.identity,
      rowIds: [...bookmark.row_ids],
      question: { populationId: selected.identity.population_id, steps: [...steps], kept: selected.kept.case_count, removed: selected.removed.case_count, parent: selected.parent.case_count },
      label: bookmark.label,
    };
  }

  unpin(pinId: number): void {
    if (this.state.pins.some((pin) => pin.id === pinId)) this.publish({ ...this.state, pins: this.state.pins.filter((pin) => pin.id !== pinId) });
  }

  /** The complete history of a pinned incident, asked in exactly the population it was pinned in; a refusal is returned as it is. */
  async pinEvidence(pinId: number, signal: AbortSignal): Promise<PinEvidence> {
    const pin = this.state.pins.find((candidate) => candidate.id === pinId);
    const population = this.state.population;
    if (!pin || population.phase !== "ready") return { ok: false, problem: { kind: "unsupported_reply", detail: "This pin is no longer held." } };
    this.caseRequestSequence += 1;
    const request: ImportedCaseEvidenceRequest = {
      schema_version: 1,
      message_type: "imported_case_evidence_request",
      request_id: `pin-${this.revision}-${this.caseRequestSequence}`,
      query_revision: this.revision,
      workspace_id: population.answer.workspace_id,
      identity: pin.identity,
      case_id: pin.caseId,
    };
    const outcome = await this.client.caseEvidence(request, signal).catch(() => unreachable);
    const checked = outcome.ok ? checkCase(request, outcome.answer) : checkProblem(request, outcome.problem);
    return checked.ok ? { ok: true, answer: checked.answer } : { ok: false, problem: checked.problem };
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

  /** Goes back one step: the selection must come back with exactly the identity it had, not merely as many incidents. */
  undo(): void {
    this.changeSteps(undone, true);
  }

  /** Shows the state after the first `count` steps of the trail, keeping the later ones until a new step is taken. */
  showAfter(count: number): void {
    this.changeSteps((history) => backTo(history, count), true);
  }

  redo(): void {
    this.changeSteps(redone, true);
  }

  /**
   * Counts what one more step would keep from the selection shown, by asking the service for that selection under the
   * shown revision. Nothing is published: the selection, its steps and its undo stay as they are until the step is taken.
   */
  async previewStep(step: SelectionPredicate, signal: AbortSignal): Promise<StepPreview> {
    const population = this.state.population;
    const selection = this.state.selection;
    if (population.phase !== "ready" || selection.phase !== "ready") return { ok: false, problem: { kind: "unreachable" } };
    this.previews += 1;
    const request: SelectCasesRequest = {
      schema_version: 1,
      message_type: "select_cases_request",
      request_id: `preview-${selection.revision}-${this.previews}`,
      query_revision: selection.revision,
      workspace_id: population.answer.workspace_id,
      identity: population.answer.identity,
      parent_case_ids: this.state.parentCaseIds === null ? null : [...this.state.parentCaseIds],
      predicates: [...selection.history.present, step],
    };
    const outcome = await this.selectionClient.selectCases(request, signal).catch(() => selectionUnreachable);
    const checked = outcome.ok ? checkSelection(request, population.answer, outcome.answer) : checkSelectionProblem(request, outcome.problem);
    if (!checked.ok) return { ok: false, problem: checked.problem };
    const { parent, kept, removed, unevaluable } = checked.answer;
    return { ok: true, parent: parent.case_count, kept: kept.case_count, removed: removed.case_count, unevaluable: unevaluable.case_count, keptIds: [...kept.case_ids] };
  }

  /**
   * The incidents these steps keep of the investigation's parent, and those they cannot evaluate, without taking them:
   * the frozen parent a comparison is made in. Nothing is published.
   */
  async keptBy(steps: readonly SelectionPredicate[], signal: AbortSignal, within?: readonly string[]): Promise<{ ok: true; keptIds: string[]; unevaluable: number; parent: number } | { ok: false; problem: SelectionProblem }> {
    const population = this.state.population;
    if (population.phase !== "ready") return { ok: false, problem: { kind: "unreachable" } };
    this.previews += 1;
    const request: SelectCasesRequest = {
      schema_version: 1,
      message_type: "select_cases_request",
      request_id: `parent-${this.revision}-${this.previews}`,
      query_revision: Math.max(this.revision, 1),
      workspace_id: population.answer.workspace_id,
      identity: population.answer.identity,
      parent_case_ids: within !== undefined ? [...within] : this.state.parentCaseIds === null ? null : [...this.state.parentCaseIds],
      predicates: [...steps],
    };
    const outcome = await this.selectionClient.selectCases(request, signal).catch(() => selectionUnreachable);
    const checked = outcome.ok ? checkSelection(request, population.answer, outcome.answer) : checkSelectionProblem(request, outcome.problem);
    if (!checked.ok) return { ok: false, problem: checked.problem };
    return { ok: true, keptIds: [...checked.answer.kept.case_ids], unevaluable: checked.answer.unevaluable.case_count, parent: checked.answer.parent.case_count };
  }

  /** The complete history of an incident in a population named by its identity, for example one side of a comparison. */
  async evidenceIn(identity: AnswerIdentity, caseId: CaseId, signal: AbortSignal): Promise<PinEvidence> {
    const population = this.state.population;
    if (population.phase !== "ready") return { ok: false, problem: { kind: "unreachable" } };
    this.caseRequestSequence += 1;
    const request: ImportedCaseEvidenceRequest = {
      schema_version: 1,
      message_type: "imported_case_evidence_request",
      request_id: `side-${this.revision}-${this.caseRequestSequence}`,
      query_revision: Math.max(this.revision, 1),
      workspace_id: population.answer.workspace_id,
      identity,
      case_id: caseId,
    };
    const outcome = await this.client.caseEvidence(request, signal).catch(() => unreachable);
    const checked = outcome.ok ? checkCase(request, outcome.answer) : checkProblem(request, outcome.problem);
    return checked.ok ? { ok: true, answer: checked.answer } : { ok: false, problem: checked.problem };
  }

  /** Gives up steps that could not be selected: the selection shown stays, with the steps and undo it was answered under. */
  staySelection(): void {
    const selection = this.state.selection;
    if (selection.phase !== "failed" || selection.shown === null || this.replacing()) return;
    this.publish({ ...this.state, selection: { phase: "ready", revision: selection.shown.revision, history: this.shownHistory, shown: selection.shown } });
  }

  retrySelection(): void {
    const selection = this.state.selection;
    if (selection.phase === "failed" && !this.replacing()) this.select(selection.history);
  }

  retryOpeningContext(): void {
    if (this.viewTarget && this.state.openingContext.phase === "failed" && !this.replacing()) this.requestOpeningContext(this.viewTarget);
  }

  retryVariants(): void {
    if (this.viewTarget && this.state.variants.phase === "failed" && !this.replacing()) this.requestVariants(this.viewTarget);
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
    this.revision = this.nextRevision();
    this.populationRequest.abandon();
    this.cancelSelectionRequest();
    this.cancelCaseRequest();
    this.cancelViewRequests();
  }

  private changeSteps(change: (history: StepHistory) => StepHistory, exact = false): void {
    const selection = this.state.selection;
    if (selection.phase === "idle" || this.replacing()) return;
    const history = change(selection.history);
    if (history === selection.history) return;
    this.select(history);
    // Set after asking: the new request has dropped any expectation of an earlier one.
    if (exact) this.expectedIdentity = this.answeredIdentities.get(this.stepsKey(history.present)) ?? null;
  }

  private stepsKey(steps: Steps): string {
    const population = this.state.population;
    return JSON.stringify([population.phase === "ready" ? population.answer.identity : null, this.state.parentCaseIds, steps]);
  }

  /** Asks for the incidents the steps keep and then for the map of exactly those, under one new revision. */
  private select(history: StepHistory): void {
    const population = this.state.population;
    if (population.phase !== "ready") return;
    this.expectedIdentity = null;
    this.revision = this.nextRevision();
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
    const expected = this.expectedIdentity;
    this.expectedIdentity = null;
    let checked = outcome.ok ? checkSelection(request, population, outcome.answer) : checkSelectionProblem(request, outcome.problem);
    if (checked.ok && restored !== null && !sameJson(checked.answer.identity, restored)) {
      checked = mismatch("The incidents selected now are not those of the saved investigation.");
    }
    if (checked.ok && expected !== null && !sameJson(checked.answer.identity, expected)) {
      checked = mismatch("The incidents selected now are not exactly those these steps kept before.");
    }
    if (checked.ok) this.answeredIdentities.set(this.stepsKey(history.present), checked.answer.identity);
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
    this.shownHistory = history;
    this.publish({
      ...this.state,
      selection: { phase: "ready", revision: request.query_revision, history, shown: { revision: request.query_revision, steps: history.present, answer: selected, graph } },
      // Without steps every incident of the parent is kept: this is the map of the whole parent.
      parentGraph: this.state.parentGraph ?? (history.present.length === 0 ? graph : null),
    });
    if (this.state.parentGraph === null) this.requestParentGraph(request, history, selected);
    if (this.pendingBookmarks !== null) {
      const bookmarks = this.pendingBookmarks;
      this.pendingBookmarks = null;
      this.publish({ ...this.state, pins: bookmarks.map((bookmark) => this.pinOf(bookmark, selected, history.present)) });
    }
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
    if (inspected.phase === "loading" && this.currentCaseRequestId === null) this.requestCase(inspected.caseId, handleOf(inspected));
  }

  /**
   * The inspector shows the complete history of a kept incident under the new selection, or of a removed one in its parent,
   * or closes; a pinned history stays in the population it was pinned in.
   */
  private followSelection(selected: SelectionAnswer): void {
    const inspected = this.state.inspected;
    if (inspected.phase === "closed" || inspected.side === "pinned") return;
    const side = inspected.side === "removed" ? "removed" : "kept";
    if (selected[side].case_ids.includes(inspected.caseId)) this.requestCase(inspected.caseId, side === "removed" ? { side } : {});
    else this.publish({ ...this.state, inspected: { phase: "closed" } });
  }

  private cancelSelectionRequest(): void {
    this.selectionRequest?.abort();
    this.selectionRequest = null;
    this.parentGraphRequest?.abort();
    this.parentGraphRequest = null;
  }

  /**
   * Asks for the map of the whole parent when a question starts with steps, as a reopened one does:
   * the map of the kept incidents is arranged from the parent's map, so without it nothing is drawn.
   * The parent is the frozen parent the selection names, never the whole source in its place.
   */
  private requestParentGraph(asked: ProcessGraphRequest, history: StepHistory, selected: SelectionAnswer): void {
    const revision = asked.query_revision;
    const request: ProcessGraphRequest = {
      schema_version: 1,
      message_type: "process_graph_request",
      request_id: `parent-graph-${revision}`,
      query_revision: revision,
      workspace_id: asked.workspace_id,
      identity: selected.parent_identity,
    };
    this.parentGraphRequest?.abort();
    const controller = new AbortController();
    this.parentGraphRequest = controller;
    const receive = (outcome: SelectionOutcome<ProcessGraphAnswer>): void => {
      if (revision !== this.revision || this.parentGraphRequest !== controller) return;
      this.parentGraphRequest = null;
      if (this.state.parentGraph !== null) return;
      const answered =
        outcome.ok &&
        outcome.answer.request_id === request.request_id &&
        outcome.answer.query_revision === revision &&
        outcome.answer.workspace_id === request.workspace_id &&
        sameJson(outcome.answer.graph.meta.selected_case_ids, selected.parent.case_ids) &&
        sameJson(outcome.answer.identity, selected.parent_identity);
      if (!outcome.ok) {
        const checked = checkSelectionProblem(request, outcome.problem);
        this.failSelection(revision, history, checked.ok ? outcome.problem : checked.problem);
        return;
      }
      if (!answered) {
        this.failSelection(revision, history, { kind: "unsupported_reply", detail: "The map of the parent names another request or population." });
        return;
      }
      this.publish({ ...this.state, parentGraph: outcome.answer.graph });
    };
    this.selectionClient.processGraph(request, controller.signal).then(receive, () => receive(selectionUnreachable));
  }

  private receivePopulation(request: OpenPopulationRequest, asked: AskedQuestion, outcome: ImportOutcome<ImportedPopulationAnswer>): void {
    if (!this.populationRequest.take(request.query_revision)) return;
    const revision = request.query_revision;
    const target = asked.target;
    const checked = outcome.ok ? checkPopulation(request, outcome.answer) : checkProblem(request, outcome.problem);
    const keeping = this.state.population.phase === "ready";
    if (!checked.ok) {
      this.publish(
        keeping
          ? { ...this.state, replacement: { phase: "failed", revision, asked, problem: checked.problem } }
          : { ...this.state, population: { phase: "failed", revision, target, problem: checked.problem } },
      );
      return;
    }
    const population: ImportedPopulationState = { phase: "ready", revision, target, answer: checked.answer };
    if (keeping) {
      // The new population replaces the question shown, its selection, views and history, in one step.
      this.leaveQuestion(revision, asked);
      this.publish({ ...initialState, ...openingOf(asked.restoration), population });
    } else {
      this.publish({ ...this.state, population });
    }
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
    const prior = this.priorHistory;
    this.priorHistory = null;
    if (!checked.ok && prior !== null) {
      this.publish({ ...this.state, inspected: { ...prior, refusal: { caseId, problem: checked.problem } } });
      return;
    }
    this.publish({
      ...this.state,
      inspected: checked.ok
        ? { phase: "ready", caseId, answer: checked.answer, ...handleOf(this.caseHandle) }
        : { phase: "failed", caseId, problem: checked.problem, ...handleOf(this.caseHandle) },
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

/** What a question opened from a saved investigation starts with; nothing for a question opened from the Data area. */
function openingOf(restoration: Restoration | null): Pick<ImportedInvestigationState, "saved" | "restoredView" | "parentCaseIds"> {
  return {
    saved: restoration ? restoration.binding : null,
    restoredView: restoration ? restoration.view : null,
    parentCaseIds: restoration ? restoration.parentCaseIds : null,
  };
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

/** The handle of an inspected incident, without the parts it does not have. */
function handleOf(handle: CaseHandle): CaseHandle {
  return {
    ...(handle.side ? { side: handle.side } : {}),
    ...(handle.side === "pinned" && handle.identity ? { identity: handle.identity } : {}),
    ...(handle.pinId !== undefined ? { pinId: handle.pinId } : {}),
  };
}
