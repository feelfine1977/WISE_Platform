import { sameJson } from "../data/coordinator";
import type {
  AnswerIdentity,
  GroupComparisonAnswer,
  GroupComparisonDefinition,
  GroupComparisonRequest,
  NamedGroupDefinition,
  PeriodComparisonAnswer,
  PeriodComparisonDefinition,
  PeriodComparisonRequest,
  PopulationSupport,
  SelectionPredicate,
  WorkspaceId,
} from "../generated/comparison";
import type { SavedComparison } from "../generated/saving";
import type { ComparisonClient, ComparisonOutcome, ComparisonProblem } from "./client";

export const contextPolicy = "incident.context.first_record_in_declared_order.v1" as const;

export type Role = "target" | "reference";
export type Clock = "utc_instant" | "wall_clock";

/** The population of an imported preparation that the comparisons are made in. */
export interface CompareBasis {
  workspaceId: WorkspaceId;
  identity: AnswerIdentity;
  /** The clock the preparation reads its times on; the days of a period are days of this clock. */
  clock: Clock;
  contextColumns: number[];
}

/** A group as the analyst chose it: the steps of a selection, or a list of incident ids. */
export interface GroupChoice {
  definition: NamedGroupDefinition;
  /** The incidents the selection kept when it was taken, as the local service answered them. */
  taken: PopulationSupport | null;
}

/** The kept and the removed side of one selection, in one step. */
export interface SplitChoice {
  /** The clause that splits the parent: what it keeps is one side, what it removes the other, what it cannot evaluate neither. */
  predicates: SelectionPredicate[];
  targetSide: "kept" | "removed";
  /** The supports of the sides when the split was taken, where they were known then. */
  taken: { kept: PopulationSupport; removed: PopulationSupport; unevaluable: PopulationSupport } | null;
}

/**
 * The parent a comparison is made in, frozen when it was taken: the incidents the retained steps keep. Incidents a
 * retained step cannot evaluate are outside it, their eligibility unknown. Null in a draft is every incident.
 */
export interface FrozenParent {
  /** The incidents of the parent; null for every incident of the population. */
  caseIds: string[] | null;
  /** The steps it is the result of; none for every incident or the investigation's own parent. */
  retained: SelectionPredicate[];
  count: number;
  /** Incidents a retained step could not evaluate: they are in no parent, so in no side. */
  eligibilityUnknown: number;
  /** Counts the parents taken in this window, so that a new parent is told apart from the one before. */
  revision: number;
}

/** A period of incident starts as picked: whole days, the first and the last day included. */
export interface PeriodChoice {
  name: string;
  from: string;
  to: string;
}

export interface CompareDraft {
  mode: "groups" | "periods";
  /** The names of group A (target) and group B (reference). */
  names: Record<Role, string>;
  groups: Record<Role, GroupChoice | null>;
  /** When set, the groups are the two sides of this selection and `groups` is not used. */
  split: SplitChoice | null;
  /** The frozen parent the comparison is made in; null for every incident of the population. */
  parent: FrozenParent | null;
  periods: Record<Role, PeriodChoice>;
  /** The minimum follow-up in hours, as typed. */
  minimum: string;
  endpoint: string | null;
  column: number | null;
}

export type ShownComparison =
  | { kind: "groups"; request: GroupComparisonRequest; answer: GroupComparisonAnswer }
  | { kind: "periods"; request: PeriodComparisonRequest; answer: PeriodComparisonAnswer };

/**
 * The comparison answered last (`shown`) stays visible, marked as pending or failed, until the
 * comparison asked for now is answered.
 */
export type ComparisonState =
  | { phase: "idle" }
  | { phase: "loading"; revision: number; shown: ShownComparison | null }
  | { phase: "ready"; revision: number; shown: ShownComparison }
  | { phase: "failed"; revision: number; shown: ShownComparison | null; problem: ComparisonProblem };

export interface CompareState {
  basis: CompareBasis | null;
  draft: CompareDraft;
  comparison: ComparisonState;
}

/** A comparison to ask for. */
type Asked = ({ kind: "groups"; definition: GroupComparisonDefinition } | { kind: "periods"; definition: PeriodComparisonDefinition }) & { parent?: string[] | null };

export const defaultNames: Record<Role, string> = { target: "Group A", reference: "Group B" };

function emptyDraft(basis: CompareBasis | null, mode: CompareDraft["mode"] = "groups"): CompareDraft {
  return {
    mode,
    names: { ...defaultNames },
    groups: { target: null, reference: null },
    split: null,
    parent: null,
    periods: { target: { name: "Period A", from: "", to: "" }, reference: { name: "Period B", from: "", to: "" } },
    minimum: "0",
    endpoint: null,
    column: basis?.contextColumns[0] ?? null,
  };
}

/** A definition ready to be sent, or the sentence that says what is still missing. */
export type Readiness<T> = { ok: true; definition: T } | { ok: false; missing: string };

export function groupDefinition(draft: CompareDraft): Readiness<GroupComparisonDefinition> {
  const names = namesMissing(draft.names.target, draft.names.reference);
  if (names) return { ok: false, missing: names };
  if (draft.split) {
    return {
      ok: true,
      definition: {
        mode: "selection_partition",
        target_name: draft.names.target,
        reference_name: draft.names.reference,
        predicates: draft.split.predicates,
        target_side: draft.split.targetSide,
      },
    };
  }
  const { target, reference } = draft.groups;
  if (!target || !reference) return { ok: false, missing: "Choose group A and group B." };
  return {
    ok: true,
    definition: {
      mode: "two_named_groups",
      target: { name: draft.names.target, definition: target.definition },
      reference: { name: draft.names.reference, definition: reference.definition },
    },
  };
}

export function periodDefinition(draft: CompareDraft, clock: Clock): Readiness<PeriodComparisonDefinition> {
  const { target, reference } = draft.periods;
  const names = namesMissing(target.name, reference.name);
  if (names) return { ok: false, missing: names };
  const targetWindow = windowOf(target, clock);
  const referenceWindow = windowOf(reference, clock);
  if (!targetWindow || !referenceWindow) return { ok: false, missing: "Pick the first and the last day of both periods." };
  const minimum = Number(draft.minimum);
  if (draft.minimum.trim() === "" || !Number.isFinite(minimum) || minimum < 0) {
    return { ok: false, missing: "Give the minimum follow-up as a number of hours, 0 or more." };
  }
  const endpoint_activity = draft.endpoint;
  if (clock === "wall_clock") {
    return {
      ok: true,
      definition: {
        target: { name: target.name, window: { timestamp_kind: "wall_clock", ...targetWindow } },
        reference: { name: reference.name, window: { timestamp_kind: "wall_clock", ...referenceWindow } },
        minimum_followup_hours: minimum,
        endpoint_activity,
      },
    };
  }
  return {
    ok: true,
    definition: {
      target: { name: target.name, window: { timestamp_kind: "utc_instant", ...targetWindow } },
      reference: { name: reference.name, window: { timestamp_kind: "utc_instant", ...referenceWindow } },
      minimum_followup_hours: minimum,
      endpoint_activity,
    },
  };
}

function namesMissing(...names: string[]): string | null {
  if (names.some((name) => name.trim() === "")) return "Give both a name.";
  if (names.some((name) => name.length > 128)) return "Keep each name to 128 characters.";
  return null;
}

const day = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The half-open window of a period of whole days: from the start of its first day up to the start
 * of the day after its last day, on the preparation's clock. A last day before the first day is
 * sent as it is; the local service refuses that window.
 */
export function windowOf(period: PeriodChoice, clock: Clock): { start_inclusive: string; end_exclusive: string } | null {
  const after = dayAfter(period.to);
  if (!day.test(period.from) || after === null) return null;
  const zone = clock === "utc_instant" ? "Z" : "";
  return { start_inclusive: `${period.from}T00:00:00${zone}`, end_exclusive: `${after}T00:00:00${zone}` };
}

function dayAfter(date: string): string | null {
  const parts = day.exec(date);
  if (!parts) return null;
  const next = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]) + 1));
  const text = next.toISOString().slice(0, 10);
  return day.test(text) ? text : null;
}

/**
 * Holds what the analyst chose to compare, in the population of the imported preparation open in
 * the investigation, and is the only place where comparison replies are published. Every
 * comparison asked for starts a new query revision; a reply of an earlier one is dropped, whether
 * it is an answer, a refusal or a failure.
 */
export class CompareCoordinator {
  private state: CompareState = { basis: null, draft: emptyDraft(null), comparison: { phase: "idle" } };
  private revision = 0;
  /** How many parents were taken; the revision of the parent shown. */
  private parents = 0;
  private request: AbortController | null = null;
  /** The comparison asked for last, which a retry asks for again. */
  private last: Asked | null = null;
  /** A saved comparison to show again: waiting for its reading to be the one compared in, or asked for. */
  private restoring: { workspaceId: WorkspaceId; identity: AnswerIdentity; saved: SavedComparison; asked: boolean } | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly client: ComparisonClient) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): CompareState => this.state;

  /** The population to compare in; another population forgets every choice and answer. */
  useBasis(basis: CompareBasis | null): void {
    if (sameJson(basis, this.state.basis)) return;
    this.abandon();
    this.last = null;
    this.publish({ basis, draft: emptyDraft(basis, this.state.draft.mode), comparison: { phase: "idle" } });
    // Another reading is compared in now: a comparison saved on a different one is not carried over to it.
    if (basis && this.restoring && !this.isRestoredReading(basis)) this.restoring = null;
    this.askForRestored();
  }

  /**
   * Shows a saved comparison again by asking for it exactly as it was saved: its parent, context
   * column, policy and definition unchanged, so that a window keeps the bounds it was saved with.
   * It is asked for once the reading it was made on is the one compared in, and forgotten when
   * another reading is. Its answer is shown only when it is the saved comparison itself.
   */
  restore(workspaceId: WorkspaceId, identity: AnswerIdentity, saved: SavedComparison | null): void {
    if (saved === null) {
      // The reopened investigation holds no comparison, so none is shown: an answer of an earlier
      // question, shown or still on its way, does not become part of it.
      this.restoring = null;
      this.abandon();
      this.last = null;
      const { basis } = this.state;
      this.publish({ basis, draft: emptyDraft(basis, this.state.draft.mode), comparison: { phase: "idle" } });
      return;
    }
    this.restoring = { workspaceId, identity, saved, asked: false };
    this.askForRestored();
  }

  setMode(mode: CompareDraft["mode"]): void {
    this.change({ mode });
  }

  rename(role: Role, name: string): void {
    this.change({ names: { ...this.state.draft.names, [role]: name } });
  }

  /** A group of the incidents the steps of a selection keep, in the parent of the comparison. */
  takeSelection(role: Role, steps: readonly SelectionPredicate[], kept: PopulationSupport): void {
    const groups = { ...this.state.draft.groups, [role]: { definition: { kind: "predicates", predicates: [...steps] }, taken: kept } };
    this.change({ groups, split: null, names: this.state.draft.split ? { ...defaultNames } : this.state.draft.names });
  }

  /**
   * A group of the incidents a condition keeps, chosen from the values in the data. How many they are
   * is first known from the comparison, so nothing is noted as taken.
   */
  takeCondition(role: Role, steps: readonly SelectionPredicate[]): void {
    const groups = { ...this.state.draft.groups, [role]: { definition: { kind: "predicates", predicates: [...steps] }, taken: null } };
    this.change({ groups, split: null, names: this.state.draft.split ? { ...defaultNames } : this.state.draft.names });
  }

  /** A group of exactly the listed incidents; the list says nothing about why they belong together. */
  takeIds(role: Role, caseIds: string[]): void {
    const groups = { ...this.state.draft.groups, [role]: { definition: { kind: "explicit_case_ids", case_ids: [...caseIds] }, taken: null } };
    this.change({ groups, split: null, names: this.state.draft.split ? { ...defaultNames } : this.state.draft.names });
  }

  /** Group A is the kept side of the selection and group B its removed side. */
  splitSelection(steps: readonly SelectionPredicate[], taken: SplitChoice["taken"]): void {
    this.change({ split: { predicates: [...steps], targetSide: "kept", taken }, names: { target: "Kept", reference: "Removed" } });
  }

  /**
   * Splits a frozen parent by one clause: A is what the clause keeps there, B what it removes, and what it cannot
   * evaluate is in neither. The names are the roles' own, from the clause, not "kept" and "removed".
   */
  splitWithin(clause: SelectionPredicate, parent: Omit<FrozenParent, "revision"> | null, taken: SplitChoice["taken"] = null): void {
    if (parent !== null) this.parents += 1;
    this.change({ split: { predicates: [clause], targetSide: "kept", taken }, parent: parent && { ...parent, revision: this.parents }, names: clauseNames(clause) });
  }

  /** Makes every incident of the population the parent again, explicitly: the retained steps no longer narrow it. */
  rebase(): void {
    if (this.state.draft.parent === null) return;
    this.parents += 1;
    this.change({ parent: null });
  }

  /** Exchanges the roles of A and B: the differences change their direction, the memberships stay. */
  swap(): void {
    const { names, groups, split } = this.state.draft;
    this.change({
      names: { target: names.reference, reference: names.target },
      groups: { target: groups.reference, reference: groups.target },
      split: split && { ...split, targetSide: split.targetSide === "kept" ? "removed" : "kept" },
    });
  }

  setPeriod(role: Role, period: Partial<PeriodChoice>): void {
    const periods = this.state.draft.periods;
    this.change({ periods: { ...periods, [role]: { ...periods[role], ...period } } });
  }

  setMinimum(minimum: string): void {
    this.change({ minimum });
  }

  setEndpoint(endpoint: string | null): void {
    this.change({ endpoint });
  }

  /** The context column whose opening values are compared; the comparison shown is asked for again with it. */
  setColumn(column: number): void {
    if (column === this.state.draft.column) return;
    this.change({ column });
    const shown = this.shown();
    if (shown) this.send(shown.kind === "groups" ? { kind: "groups", definition: shown.request.definition } : { kind: "periods", definition: shown.request.definition });
  }

  compareGroups(): void {
    const ready = groupDefinition(this.state.draft);
    if (ready.ok) this.send({ kind: "groups", definition: ready.definition });
  }

  comparePeriods(): void {
    const basis = this.state.basis;
    if (!basis) return;
    const ready = periodDefinition(this.state.draft, basis.clock);
    if (ready.ok) this.send({ kind: "periods", definition: ready.definition });
  }

  retry(): void {
    const comparison = this.state.comparison;
    if (comparison.phase !== "failed") return;
    if (this.last) this.send(this.last);
    else if (this.restoring?.asked) this.replay(this.restoring.saved);
  }

  /**
   * The comparison shown, as a saved investigation holds it, when it was made on this reading of
   * this workspace; nothing while no answered comparison is shown or it belongs to another reading.
   * Its parent is the one the answer names, so saving it never widens or narrows what was compared.
   */
  savedComparisonFor(workspaceId: WorkspaceId, identity: AnswerIdentity): SavedComparison | null {
    const { basis, comparison } = this.state;
    if (!basis || comparison.phase !== "ready") return null;
    if (basis.workspaceId !== workspaceId || !sameJson(basis.identity, identity)) return null;
    const { shown } = comparison;
    const common = {
      comparison_id: shown.answer.comparison_id,
      parent_case_ids: [...shown.answer.parent.case_ids],
      context_column_index: shown.request.context_column_index,
      context_policy: shown.request.context_policy,
    };
    return shown.kind === "groups"
      ? { kind: "group", ...common, definition: shown.request.definition }
      : { kind: "period", ...common, definition: shown.request.definition };
  }

  /** Abandons the outstanding request; its reply is dropped when it arrives. */
  stop(): void {
    this.abandon();
  }

  private isRestoredReading(basis: CompareBasis): boolean {
    const restoring = this.restoring;
    return restoring !== null && basis.workspaceId === restoring.workspaceId && sameJson(basis.identity, restoring.identity);
  }

  /** Asks for the saved comparison once, as soon as its own reading is the one compared in; until then it waits. */
  private askForRestored(): void {
    const { basis } = this.state;
    const restoring = this.restoring;
    if (!restoring || restoring.asked || !basis || !this.isRestoredReading(basis)) return;
    restoring.asked = true;
    this.replay(restoring.saved);
  }

  private replay(saved: SavedComparison): void {
    const { basis } = this.state;
    if (!basis) return;
    this.request?.abort();
    this.revision += 1;
    const revision = this.revision;
    const envelope = {
      schema_version: 1 as const,
      request_id: `compare-${revision}`,
      query_revision: revision,
      workspace_id: basis.workspaceId,
      identity: basis.identity,
      parent_case_ids: [...saved.parent_case_ids],
      context_column_index: saved.context_column_index,
      context_policy: saved.context_policy,
    };
    const controller = new AbortController();
    this.request = controller;
    this.last = null;
    this.publish({
      ...this.state,
      draft: { ...this.state.draft, mode: saved.kind === "group" ? "groups" : "periods", column: saved.context_column_index },
      comparison: { phase: "loading", revision, shown: null },
    });
    const theSaved = <Answer extends GroupComparisonAnswer | PeriodComparisonAnswer>(outcome: ComparisonOutcome<Answer>): ComparisonOutcome<Answer> =>
      outcome.ok && outcome.answer.comparison_id !== saved.comparison_id
        ? mismatch("The comparison computed again is not the saved one.")
        : outcome;
    if (saved.kind === "group") {
      const request: GroupComparisonRequest = { ...envelope, message_type: "compare_groups_request", definition: saved.definition };
      this.client.compareGroups(request, controller.signal).then(
        (outcome) => this.receive(request, theSaved(outcome), (answer) => ({ kind: "groups", request, answer })),
        () => this.receive(request, unreachable, (answer: GroupComparisonAnswer) => ({ kind: "groups", request, answer })),
      );
    } else {
      const request: PeriodComparisonRequest = { ...envelope, message_type: "compare_periods_request", definition: saved.definition };
      this.client.comparePeriods(request, controller.signal).then(
        (outcome) => this.receive(request, theSaved(outcome), (answer) => ({ kind: "periods", request, answer })),
        () => this.receive(request, unreachable, (answer: PeriodComparisonAnswer) => ({ kind: "periods", request, answer })),
      );
    }
  }

  private send(asked: Asked): void {
    const { basis, draft } = this.state;
    if (!basis || draft.column === null) return;
    this.restoring = null;
    this.request?.abort();
    this.revision += 1;
    const revision = this.revision;
    const envelope = {
      schema_version: 1 as const,
      request_id: `compare-${revision}`,
      query_revision: revision,
      workspace_id: basis.workspaceId,
      identity: basis.identity,
      parent_case_ids: asked.parent === undefined ? (draft.parent?.caseIds ? [...draft.parent.caseIds] : null) : asked.parent,
      context_column_index: draft.column,
      context_policy: contextPolicy,
    };
    const controller = new AbortController();
    this.request = controller;
    this.publish({ ...this.state, comparison: { phase: "loading", revision, shown: this.shown() } });
    this.last = { ...asked, parent: envelope.parent_case_ids };
    if (asked.kind === "groups") {
      const request: GroupComparisonRequest = { ...envelope, message_type: "compare_groups_request", definition: asked.definition };
      this.client.compareGroups(request, controller.signal).then(
        (outcome) => this.receive(request, outcome, (answer) => ({ kind: "groups", request, answer })),
        () => this.receive(request, unreachable, (answer: GroupComparisonAnswer) => ({ kind: "groups", request, answer })),
      );
    } else {
      const request: PeriodComparisonRequest = { ...envelope, message_type: "compare_periods_request", definition: asked.definition };
      this.client.comparePeriods(request, controller.signal).then(
        (outcome) => this.receive(request, outcome, (answer) => ({ kind: "periods", request, answer })),
        () => this.receive(request, unreachable, (answer: PeriodComparisonAnswer) => ({ kind: "periods", request, answer })),
      );
    }
  }

  private receive<Answer extends GroupComparisonAnswer | PeriodComparisonAnswer>(
    request: GroupComparisonRequest | PeriodComparisonRequest,
    outcome: ComparisonOutcome<Answer>,
    shownOf: (answer: Answer) => ShownComparison,
  ): void {
    if (request.query_revision !== this.revision) return;
    this.request = null;
    const checked = outcome.ok ? checkAnswer(request, outcome.answer) : checkProblem(request, outcome.problem);
    const revision = request.query_revision;
    if (!checked.ok) {
      this.publish({ ...this.state, comparison: { phase: "failed", revision, shown: this.shown(), problem: checked.problem } });
      return;
    }
    this.publish({ ...this.state, comparison: { phase: "ready", revision, shown: shownOf(checked.answer) } });
  }

  private shown(): ShownComparison | null {
    const comparison = this.state.comparison;
    return comparison.phase === "idle" ? null : comparison.shown;
  }

  private change(part: Partial<CompareDraft>): void {
    this.publish({ ...this.state, draft: { ...this.state.draft, ...part } });
  }

  /** Drops the reply of the outstanding request, if there is one, whenever it arrives. */
  private abandon(): void {
    this.revision += 1;
    this.request?.abort();
    this.request = null;
  }

  private publish(state: CompareState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

const unreachable: ComparisonOutcome<never> = { ok: false, problem: { kind: "unreachable" } };

function mismatch(detail: string): ComparisonOutcome<never> {
  return { ok: false, problem: { kind: "unsupported_reply", detail } };
}

/** An answer about another request, workspace, population, column or pair of names does not answer this one. */
function checkAnswer<Answer extends GroupComparisonAnswer | PeriodComparisonAnswer>(
  request: GroupComparisonRequest | PeriodComparisonRequest,
  answer: Answer,
): ComparisonOutcome<Answer> {
  if (answer.request_id !== request.request_id || answer.query_revision !== request.query_revision) {
    return mismatch("The reply names a different request or query revision.");
  }
  if (answer.workspace_id !== request.workspace_id) return mismatch("The reply belongs to a different workspace.");
  if (!sameJson(answer.identity, request.identity)) return mismatch("The reply belongs to a different population identity.");
  if (answer.context_column_index !== request.context_column_index) return mismatch("The reply compares a different context column.");
  const [target, reference] = requestedNames(request);
  if (answer.target.name !== target || answer.reference.name !== reference) return mismatch("The reply compares differently named groups.");
  return { ok: true, answer };
}

function requestedNames(request: GroupComparisonRequest | PeriodComparisonRequest): [string, string] {
  const definition = request.definition;
  if ("mode" in definition && definition.mode === "selection_partition") return [definition.target_name, definition.reference_name];
  if ("mode" in definition) return [definition.target.name, definition.reference.name];
  return [definition.target.name, definition.reference.name];
}

/** A refusal that names another request or revision does not answer this one. */
function checkProblem(request: GroupComparisonRequest | PeriodComparisonRequest, problem: ComparisonProblem): ComparisonOutcome<never> {
  if (problem.kind === "refusal") {
    const { request_id, query_revision } = problem.refusal;
    if ((request_id !== null && request_id !== request.request_id) || (query_revision !== null && query_revision !== request.query_revision)) {
      return mismatch("The refusal names a different request or query revision.");
    }
  }
  return { ok: false, problem };
}

/**
 * The names of the two sides of a clause, said as what is recorded: an activity recorded or not recorded, never a
 * business state such as open or unresolved; any other clause as meeting it or not.
 */
export function clauseNames(clause: SelectionPredicate): Record<Role, string> {
  if (clause.kind === "contains_activity") {
    const recorded = `Recorded “${clause.activity}”`;
    const absent = `No recorded “${clause.activity}”`;
    return clause.negate ? { target: absent, reference: recorded } : { target: recorded, reference: absent };
  }
  return { target: "Meets the clause", reference: "Does not meet the clause" };
}
