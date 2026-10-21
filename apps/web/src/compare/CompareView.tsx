import { InvestigationPrerequisite } from "../components/InvestigationPrerequisite";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { countOf } from "../data/wording";
import type {
  CategoryComparison,
  ContextProfile,
  GroupComparisonAnswer,
  PeriodCohort,
  PeriodComparisonAnswer,
  PopulationSupport,
  SelectionPredicate,
} from "../generated/comparison";
import type { ImportedPopulationAnswer } from "../generated/imports";
import { type ImportedInvestigationCoordinator, shownSelection } from "../imported/coordinator";
import { describeImportProblem } from "../data/wording";
import type { ImportedCaseEvidenceAnswer } from "../generated/imports";
import { stepWording, supportText } from "../map/wording";
import { RecordsTable } from "../pinned/PairedHistories";
import { OutcomeSection } from "./OutcomeSection";
import type { ComparisonProblem } from "./client";
import {
  type CompareBasis,
  type CompareCoordinator,
  type CompareDraft,
  contextPolicy,
  type FrozenParent,
  groupDefinition,
  periodDefinition,
  type Role,
  type ShownComparison,
} from "./coordinator";
import {
  cutoffText,
  describeComparisonProblem,
  differenceCell,
  groupWording,
  ratioCell,
  hoursText,
  overlapSentences,
  partOf,
  shareText,
  valueText,
} from "./wording";
import "./compare.css";

interface CompareViewProps {
  coordinator: CompareCoordinator;
  investigation: ImportedInvestigationCoordinator;
  onShowData: () => void;
  onShowInvestigation: () => void;
}

const letters: Record<Role, string> = { target: "A", reference: "B" };

/** The population of the imported preparation open in the investigation, as the comparisons need it. */
export function basisOf(answer: ImportedPopulationAnswer): CompareBasis {
  const time = answer.preparation.policies.time;
  return {
    workspaceId: answer.workspace_id,
    identity: answer.identity,
    clock: time.id === "incident.time.wall_clock_as_recorded.v1" ? "wall_clock" : "utc_instant",
    contextColumns: answer.preparation.mapping.context_columns,
  };
}

/**
 * Compares two groups of whole incidents, or the incidents started in two periods, of the
 * population open in the investigation. Every count, share, difference and membership shown is
 * the local service's answer; the screen says how the groups differ, never why.
 */
export function CompareView({ coordinator, investigation, onShowData, onShowInvestigation }: CompareViewProps) {
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getState);
  const investigated = useSyncExternalStore(investigation.subscribe, investigation.getState);
  const population = investigated.population.phase === "ready" ? investigated.population.answer : null;
  const basis = useMemo(() => (population ? basisOf(population) : null), [population]);
  const [added, setAdded] = useState<SelectionPredicate | null>(null);
  const [inspected, setInspected] = useState<InspectedValue | null>(null);
  const waitingReason = useId();
  // While other incidents open in Investigations, no step is added to the selection they replace.
  const waitingFor = investigated.replacement?.phase === "running" ? waitingReason : undefined;

  useEffect(() => coordinator.useBasis(basis), [coordinator, basis]);

  const columnNames = useMemo(() => {
    const names = new Map<number, string>();
    if (investigated.openingContext.phase === "ready") {
      for (const column of investigated.openingContext.answer.opening_context.columns) names.set(column.column_index, column.column_name);
    }
    return names;
  }, [investigated.openingContext]);
  const columnName = (index: number) => columnNames.get(index) ?? `column ${index}`;

  if (!population || !state.basis) {
    return (
      <main className="compare" aria-labelledby="compare-title">
        <div className="compare-head">
          <h2 id="compare-title" className="compare-title">
            Compare
          </h2>
        </div>
        <div className="compare-empty">
          <InvestigationPrerequisite state={investigated} purpose="Comparisons are made in the cases of a source read in the Data area." needsSelection={false}
            onShowData={onShowData} onShowInvestigation={onShowInvestigation} onRetryPopulation={() => investigation.retryPopulation()}
            onRetrySelection={() => investigation.retrySelection()} />
        </div>
      </main>
    );
  }

  const { draft, comparison } = state;
  const shown = comparison.phase === "idle" ? null : comparison.shown;
  const selection = shownSelection(investigated.selection);
  const activities = investigated.parentGraph?.nodes.map((node) => node.label) ?? [];
  // The values the investigation shows for each context column: its most frequent ones, and "not recorded" where it occurs.
  const openings: OpeningChoice[] =
    investigated.openingContext.phase === "ready"
      ? investigated.openingContext.answer.opening_context.columns.map((item) => ({
          index: item.column_index,
          name: item.column_name.trim() === "" ? `Column ${item.column_index}` : item.column_name,
          values: item.categories.map((category) => category.value),
        }))
      : [];

  function addStep(step: SelectionPredicate) {
    if (waitingFor) return;
    investigation.addStep(step);
    setAdded(step);
  }

  return (
    <main className="compare" aria-labelledby="compare-title">
      <div className="compare-head">
        <h2 id="compare-title" className="compare-title">
          Compare
        </h2>
        <ParentLine filename={population.source.filename} every={supportText(population.population)} parent={draft.parent} onRebase={() => coordinator.rebase()} />
      </div>
      <div className="compare-body">
        <section className="compare-setup" aria-labelledby="compare-setup-title">
          <h3 id="compare-setup-title" className="compare-section-title">
            What to compare
          </h3>
          <div className="compare-modes" role="group" aria-label="Compare">
            <button type="button" aria-pressed={draft.mode === "groups"} onClick={() => coordinator.setMode("groups")}>
              Two groups
            </button>
            <button type="button" aria-pressed={draft.mode === "periods"} onClick={() => coordinator.setMode("periods")}>
              Two periods
            </button>
          </div>
          {draft.mode === "groups" ? (
            <GroupsSetup coordinator={coordinator} draft={draft} selection={selection} activities={activities} openings={openings} investigation={investigation}
              parentCaseIds={investigated.parentCaseIds} />
          ) : (
            <PeriodsSetup coordinator={coordinator} draft={draft} clock={state.basis.clock} activities={activities} />
          )}
          {draft.mode === "groups" && <StratumChoice coordinator={coordinator} investigation={investigation} openings={openings} parentCaseIds={investigated.parentCaseIds} />}
          <ColumnChoice
            columns={state.basis.contextColumns}
            chosen={draft.column}
            name={columnName}
            onChoose={(column) => coordinator.setColumn(column)}
          />
          <CompareAction coordinator={coordinator} draft={draft} basis={state.basis} />
        </section>
        <section className="compare-result" aria-labelledby="compare-result-title" aria-busy={comparison.phase === "loading"}>
          <h3 id="compare-result-title" className="compare-section-title">
            How they differ
          </h3>
          <p role="status" className="compare-status">
            {comparison.phase === "loading"
              ? "Comparing…"
              : comparison.phase === "ready"
                ? `Comparison shown · revision ${comparison.revision}`
                : ""}
          </p>
          {comparison.phase === "failed" && (
            <ComparisonProblemNotice
              title={shown ? "This comparison could not be made; the previous one is still shown" : "The comparison could not be made"}
              problem={comparison.problem}
              onRetry={() => coordinator.retry()}
            />
          )}
          {!shown && comparison.phase !== "failed" && comparison.phase !== "loading" && (
            <p className="compare-muted">Choose what to compare, then press Compare.</p>
          )}
          {added && (
            <div className="compare-added" role="status">
              <p>Added to the selection in Investigations: {stepWording(added)}.</p>
              <button type="button" onClick={onShowInvestigation}>
                Show the selection
              </button>
            </div>
          )}
          {waitingFor && (
            <p id={waitingFor} className="compare-hidden">
              No step can be added while other cases are opening in Investigations.
            </p>
          )}
          {shown && <ComparisonTable shown={shown} columnName={columnName(shown.answer.context_column_index)} onStep={addStep} waitingFor={waitingFor}
            onInspect={setInspected} />}
          {shown && <EmptySide shown={shown} frozen={draft.parent !== null} onRebase={() => coordinator.rebase()} onSwap={() => coordinator.swap()} onShowInvestigation={onShowInvestigation} />}
          {shown && shown.kind === "periods" && (
            <FollowupChoice key={`followup-${shown.answer.comparison_id}`} shown={shown} restricted={draft.parent?.label?.startsWith("followed for at least") ?? false}
              onRestrict={(parent) => coordinator.freeze(parent)} onRebase={() => coordinator.rebase()} />
          )}
          {shown && <SideIncidents key={`sides-${shown.answer.comparison_id}`} shown={shown} investigation={investigation} inspected={inspected} />}
          {shown && shown.kind === "groups" && (
            <OutcomeSection answer={shown.answer} columnName={columnName(shown.answer.context_column_index)} activities={activities}
              investigation={investigation} chosen={draft.outcome} onChoose={(outcome) => coordinator.setOutcome(outcome)} />
          )}
        </section>
      </div>
    </main>
  );
}

interface GroupsSetupProps {
  coordinator: CompareCoordinator;
  draft: CompareDraft;
  selection: ReturnType<typeof shownSelection>;
  /** Freezes the parent of a split: the incidents the steps before the last keep. */
  investigation?: ImportedInvestigationCoordinator;
  /** The investigation's own parent; null for every incident. */
  parentCaseIds?: string[] | null;
  /** The activities of the parent's map, to choose a group by. */
  activities: string[];
  /** The context columns with the opening values the investigation shows, to choose a group by. */
  openings: OpeningChoice[];
}

/** A context column with the opening values that can be chosen from; null stands for "not recorded". */
interface OpeningChoice {
  index: number;
  name: string;
  values: (string | null)[];
}

function GroupsSetup({ coordinator, draft, selection, activities, openings, investigation, parentCaseIds = null }: GroupsSetupProps) {
  const steps = selection?.steps ?? [];
  const [freezing, setFreezing] = useState<{ phase: "idle" } | { phase: "working" } | { phase: "failed"; message: string }>({ phase: "idle" });
  /**
   * A on the incidents the last step keeps and B on those it removes, within the parent frozen after every earlier
   * step: the incidents the earlier steps keep. With one step the parent is the investigation's own.
   */
  async function split() {
    if (selection === null || steps.length === 0) return;
    const clause = steps[steps.length - 1];
    if (steps.length === 1 || !investigation) {
      // One step: the parent is the investigation's own, every incident unless a saved parent narrows it.
      coordinator.splitWithin(clause, parentCaseIds === null ? null : { caseIds: [...parentCaseIds], retained: [], count: selection.answer.parent.case_count, eligibilityUnknown: 0 },
        { kept: selection.answer.kept, removed: selection.answer.removed, unevaluable: selection.answer.unevaluable });
      return;
    }
    const retained = steps.slice(0, -1);
    setFreezing({ phase: "working" });
    const frozen = await investigation.keptBy(retained, new AbortController().signal);
    if (!frozen.ok) {
      setFreezing({ phase: "failed", message: frozen.problem.kind === "refusal" ? frozen.problem.refusal.message : "The parent could not be selected; try again." });
      return;
    }
    setFreezing({ phase: "idle" });
    coordinator.splitWithin(clause, { caseIds: frozen.keptIds, retained, count: frozen.keptIds.length, eligibilityUnknown: frozen.unevaluable });
  }
  return (
    <>
      <p className="compare-muted">
        Choose each group from the data: the cases with or without an activity, that begin or end with an activity, or whose first recorded observation has a value. A
        group can also be the current selection of the investigation, and "Kept against removed" compares the two sides of that selection in one
        step.
      </p>
      <div className="compare-selection">
        <p>
          <span className="compare-label">Current selection</span>{" "}
          {selection === null
            ? "not answered yet"
            : steps.length === 0
              ? `no step: keeps every case, ${supportText(selection.answer.kept)}`
              : `${steps.map(stepWording).join("; and ")}. Kept ${supportText(selection.answer.kept)}; removed ${supportText(selection.answer.removed)}; not evaluable ${supportText(selection.answer.unevaluable)}.`}
        </p>
        <button
          type="button"
          disabled={selection === null || steps.length === 0}
          aria-describedby="compare-split-hint"
          onClick={() => void split()}
        >
          Kept against removed
        </button>
        <p id="compare-split-hint" className="compare-muted">
          The last step splits the parent: A holds what it keeps, B what it removes. The parent is frozen after every earlier step, so a case an
          earlier step removed is in neither side.
        </p>
        {freezing.phase === "working" && <p className="working-text">Freezing the parent of the earlier steps…</p>}
        {freezing.phase === "failed" && <p role="alert">{freezing.message}</p>}
        {selection !== null && steps.length === 0 && (
          <p className="compare-muted">Add a step to the selection in Investigations to compare its kept and removed cases.</p>
        )}
      </div>
      <div className="compare-groups">
        {(["target", "reference"] as const).map((role) => (
          <GroupSlot key={role} role={role} coordinator={coordinator} draft={draft} selection={selection} activities={activities} openings={openings} />
        ))}
      </div>
      <button type="button" onClick={() => coordinator.swap()}>
        Exchange A and B
      </button>
    </>
  );
}

/** The conditions on an activity a group can be chosen by: the kind of step each stands for, and whether it is its opposite. */
const activityConditions = {
  with: { kind: "contains_activity", negate: false },
  without: { kind: "contains_activity", negate: true },
  begins: { kind: "starts_with_activity", negate: false },
  "not-begins": { kind: "starts_with_activity", negate: true },
  ends: { kind: "ends_with_activity", negate: false },
  "not-ends": { kind: "ends_with_activity", negate: true },
} as const;

type ActivityCondition = keyof typeof activityConditions;
type ConditionKind = ActivityCondition | "opened" | "not-opened";

const isActivityCondition = (kind: ConditionKind): kind is ActivityCondition => kind in activityConditions;

/** The words of a missing opening value in a list of values. */
const NOT_RECORDED = "(not recorded)";

function GroupSlot({ role, coordinator, draft, selection, activities, openings }: { role: Role } & GroupsSetupProps) {
  const letter = letters[role];
  const nameId = useId();
  const idsId = useId();
  const kindId = useId();
  const [ids, setIds] = useState("");
  const [kind, setKind] = useState<ConditionKind>("with");
  const [activity, setActivity] = useState("");
  const [column, setColumn] = useState<number | null>(null);
  const [value, setValue] = useState<number | null>(null);
  const group = draft.groups[role];
  const other = draft.groups[role === "target" ? "reference" : "target"];
  const otherLetter = letters[role === "target" ? "reference" : "target"];
  const byActivity = isActivityCondition(kind);
  const opening = openings.find((item) => item.index === column) ?? null;
  const condition: SelectionPredicate | null = isActivityCondition(kind)
    ? activity === ""
      ? null
      : { ...activityConditions[kind], activity }
    : opening === null || value === null || value >= opening.values.length
      ? null
      : { kind: "opening_attribute_equals", column_index: opening.index, value: opening.values[value], negate: kind === "not-opened", anchor_policy: contextPolicy };
  const opposite =
    other && other.definition.kind === "predicates" && other.definition.predicates.length === 1
      ? ({ ...other.definition.predicates[0], negate: !other.definition.predicates[0].negate } as SelectionPredicate)
      : null;
  const listed = [...new Set(ids.split(/[\s,;]+/).filter((id) => id !== ""))];
  let description: ReactNode;
  if (draft.split && draft.split.taken === null) {
    const side = role === "target" ? draft.split.targetSide : draft.split.targetSide === "kept" ? "removed" : "kept";
    description = (
      <>
        The cases of the frozen parent the clause {side === "kept" ? "keeps (included)" : "removes (excluded)"}: {draft.split.predicates.map(stepWording).join("; and ")}.
        Those it cannot evaluate belong to neither side.
      </>
    );
  } else if (draft.split && draft.split.taken) {
    const side = role === "target" ? draft.split.targetSide : draft.split.targetSide === "kept" ? "removed" : "kept";
    const support = side === "kept" ? draft.split.taken.kept : draft.split.taken.removed;
    description = (
      <>
        The {side} cases of the selection: {draft.split.predicates.map(stepWording).join("; and ")}. When it was taken it {side}{" "}
        {supportText(support)}
        {draft.split.taken.unevaluable.case_count > 0 && <>; {supportText(draft.split.taken.unevaluable)} not evaluable belong to neither side</>}.
      </>
    );
  } else if (group) {
    description = (
      <>
        {groupWording(group.definition)}
        {group.taken && <>. When it was taken the selection kept {supportText(group.taken)}</>}.
      </>
    );
  } else {
    description = <span className="compare-muted">Not chosen yet.</span>;
  }
  return (
    <fieldset className="compare-group">
      <legend className="compare-group-letter">Group {letter}</legend>
      <label htmlFor={nameId} className="compare-label">
        Name of group {letter}
      </label>
      <input id={nameId} type="text" value={draft.names[role]} maxLength={128} onChange={(event) => coordinator.rename(role, event.target.value)} />
      <p className="compare-group-definition">{description}</p>
      <div className="compare-define">
        <label htmlFor={kindId} className="compare-label">
          Cases that
        </label>
        <select id={kindId} value={kind} onChange={(event) => setKind(event.target.value as ConditionKind)}>
          <option value="with">contain the activity</option>
          <option value="without">do not contain the activity</option>
          <option value="begins">begin with the activity</option>
          <option value="not-begins">do not begin with the activity</option>
          <option value="ends">end with the activity</option>
          <option value="not-ends">do not end with the activity</option>
          {openings.length > 0 && <option value="opened">were first recorded with</option>}
          {openings.length > 0 && <option value="not-opened">were not first recorded with</option>}
        </select>
        {byActivity ? (
          <select aria-label={`Activity for group ${letter}`} value={activity} onChange={(event) => setActivity(event.target.value)}>
            <option value="">Choose an activity</option>
            {activities.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <>
            <select
              aria-label={`Column for group ${letter}`}
              value={column ?? ""}
              onChange={(event) => {
                setColumn(event.target.value === "" ? null : Number(event.target.value));
                setValue(null);
              }}
            >
              <option value="">Choose a column</option>
              {openings.map((item) => (
                <option key={item.index} value={item.index}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              aria-label={`Value for group ${letter}`}
              value={value ?? ""}
              disabled={opening === null}
              onChange={(event) => setValue(event.target.value === "" ? null : Number(event.target.value))}
            >
              <option value="">Choose a value</option>
              {(opening?.values ?? []).map((item, index) => (
                <option key={index} value={index}>
                  {item === null ? NOT_RECORDED : item}
                </option>
              ))}
            </select>
          </>
        )}
        <button type="button" className="primary" disabled={condition === null} onClick={() => condition && coordinator.takeCondition(role, [condition])}>
          Use as {letter}
        </button>
        {opposite && (
          <button type="button" onClick={() => coordinator.takeCondition(role, [opposite])}>
            The opposite of {otherLetter} as {letter}
          </button>
        )}
      </div>
      <button
        type="button"
        disabled={selection === null}
        onClick={() => selection && coordinator.takeSelection(role, selection.steps, selection.answer.kept)}
      >
        Take the current selection as {letter}
      </button>
      <details className="compare-ids">
        <summary>List case ids for {letter}</summary>
        <label htmlFor={idsId} className="compare-label">
          Case ids, separated by spaces, commas or new lines
        </label>
        <textarea id={idsId} value={ids} rows={3} onChange={(event) => setIds(event.target.value)} />
        <button type="button" disabled={listed.length === 0} onClick={() => coordinator.takeIds(role, listed)}>
          Use these ids as {letter}
        </button>
      </details>
    </fieldset>
  );
}

interface PeriodsSetupProps {
  coordinator: CompareCoordinator;
  draft: CompareDraft;
  clock: CompareBasis["clock"];
  activities: string[];
}

function PeriodsSetup({ coordinator, draft, clock, activities }: PeriodsSetupProps) {
  const minimumId = useId();
  const endpointId = useId();
  return (
    <>
      <p className="compare-muted">
        A case belongs to a period when its first record falls on one of its days ({clock === "wall_clock" ? "days as recorded" : "days in UTC"}
        ). Every record of the case counts, also those after the period.
      </p>
      <div className="compare-groups">
        {(["target", "reference"] as const).map((role) => (
          <PeriodSlot key={role} role={role} coordinator={coordinator} draft={draft} />
        ))}
      </div>
      <div className="compare-fields">
        <div className="compare-field">
          <label htmlFor={minimumId} className="compare-label">
            Minimum follow-up in hours
          </label>
          <input
            id={minimumId}
            type="number"
            min={0}
            step="any"
            value={draft.minimum}
            onChange={(event) => coordinator.setMinimum(event.target.value)}
          />
        </div>
        <div className="compare-field">
          <label htmlFor={endpointId} className="compare-label">
            Recorded activity to look for
          </label>
          <select id={endpointId} value={draft.endpoint ?? ""} onChange={(event) => coordinator.setEndpoint(event.target.value === "" ? null : event.target.value)}>
            <option value="">None</option>
            {activities.map((activity) => (
              <option key={activity} value={activity}>
                {activity}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}

function PeriodSlot({ role, coordinator, draft }: { role: Role; coordinator: CompareCoordinator; draft: CompareDraft }) {
  const letter = letters[role];
  const period = draft.periods[role];
  const nameId = useId();
  const fromId = useId();
  const toId = useId();
  return (
    <fieldset className="compare-group">
      <legend className="compare-group-letter">Period {letter}</legend>
      <label htmlFor={nameId} className="compare-label">
        Name of period {letter}
      </label>
      <input id={nameId} type="text" value={period.name} maxLength={128} onChange={(event) => coordinator.setPeriod(role, { name: event.target.value })} />
      <div className="compare-days">
        <div className="compare-field">
          <label htmlFor={fromId} className="compare-label">
            First day of {letter}
          </label>
          <input id={fromId} type="date" value={period.from} onChange={(event) => coordinator.setPeriod(role, { from: event.target.value })} />
        </div>
        <div className="compare-field">
          <label htmlFor={toId} className="compare-label">
            Last day of {letter}
          </label>
          <input id={toId} type="date" value={period.to} onChange={(event) => coordinator.setPeriod(role, { to: event.target.value })} />
        </div>
      </div>
    </fieldset>
  );
}

interface ColumnChoiceProps {
  columns: number[];
  chosen: number | null;
  name: (index: number) => string;
  onChoose: (column: number) => void;
}

function ColumnChoice({ columns, chosen, name, onChoose }: ColumnChoiceProps) {
  const id = useId();
  if (columns.length === 0) {
    return (
      <p className="compare-muted">
        This reading of the source has no context column, so there is no opening value to compare. Choose context columns when you read the
        source in the Data area.
      </p>
    );
  }
  return (
    <div className="compare-field">
      <label htmlFor={id} className="compare-label">
        Opening value of
      </label>
      <select id={id} value={chosen ?? ""} onChange={(event) => onChoose(Number(event.target.value))}>
        {columns.map((column) => (
          <option key={column} value={column}>
            {name(column)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Compare asks for the comparison chosen now; one still pending is abandoned and its reply dropped. */
function CompareAction({ coordinator, draft, basis }: { coordinator: CompareCoordinator; draft: CompareDraft; basis: CompareBasis }) {
  const hintId = useId();
  const ready = draft.mode === "groups" ? groupDefinition(draft) : periodDefinition(draft, basis.clock);
  const missing = draft.column === null ? "The source needs a context column." : ready.ok ? null : ready.missing;
  return (
    <div className="compare-action">
      <button
        type="button"
        className="compare-primary"
        disabled={missing !== null}
        aria-describedby={missing ? hintId : undefined}
        onClick={() => (draft.mode === "groups" ? coordinator.compareGroups() : coordinator.comparePeriods())}
      >
        Compare
      </button>
      {missing && (
        <p id={hintId} className="compare-muted">
          {missing}
        </p>
      )}
    </div>
  );
}

interface Row {
  key: string;
  measure: ReactNode;
  detail?: string;
  a: string;
  b: string;
  difference: string | null;
  /** A's share divided by B's share, for an opening value; shown only on request. */
  ratio?: string;
  step?: { predicate: SelectionPredicate; label: string };
  /** The opening value whose incidents of A and B can be listed, without a step. */
  inspect?: { value: string | null; label: string };
}

/** An opening value whose incidents of each side are listed, as the local service selects them. */
export interface InspectedValue {
  columnIndex: number;
  value: string | null;
  label: string;
}

interface ComparisonTableProps {
  shown: ShownComparison;
  columnName: string;
  onStep: (step: SelectionPredicate) => void;
  /** The id of the text saying why no step can be added now; while it is given, the steps wait. */
  waitingFor?: string;
  /** Lists the incidents of A and B first recorded with one value; the selection stays. */
  onInspect?: (value: InspectedValue) => void;
}

function ComparisonTable({ shown, columnName, onStep, waitingFor, onInspect }: ComparisonTableProps) {
  const answer = shown.answer;
  const names: [string, string] = [answer.target.name, answer.reference.name];
  // The paired counts and shares are shown first; the ratio of the shares is asked for.
  const [ratio, setRatio] = useState(false);
  const rows: Row[] = [...cohortRows(answer)];
  if (shown.kind === "periods") rows.push(...periodRows(shown.answer, shown.request.definition.minimum_followup_hours));
  rows.push(...profileRows(answer, columnName));
  const kind = shown.kind === "periods" ? "period" : "group";
  return (
    <>
      <p className="compare-roles">
        <strong>A</strong> is {kind} {names[0]}; <strong>B</strong> is {kind} {names[1]}. {roleDefinitions(shown)}
      </p>
      <p className="compare-muted">
        In a parent of {countOf(answer.parent.case_count, "case")}: A has {countOf(answer.target.included.case_count, "case")} and B{" "}
        {countOf(answer.reference.included.case_count, "case")}
        {answer.target.included.case_count !== answer.reference.included.case_count && ", so their sizes differ: every share is of a group's own cases"}. The context
        compared is the value of {columnName} at each case's first record in the declared order ({answer.context_policy}), common to both groups; values recorded later
        or last are not offered.
      </p>
      <div className="compare-actions">
        <button type="button" aria-pressed={ratio} onClick={() => setRatio(!ratio)}>
          {ratio ? "Hide the ratio of shares" : "Show the ratio of shares"}
        </button>
      </div>
      {ratio && (
        <p className="compare-muted">
          The ratio divides the share of a value in A ({names[0]}) by its share in B ({names[1]}), each of its own cases with a readable first
          record: above 1 the value is more frequent in A, below 1 in B. Exchanging A and B turns it over. A share of 0 in B gives no ratio, only no
          reference support. It describes this snapshot; it is not a risk, a lift or a priority.
        </p>
      )}
      <div className="compare-scroll">
        <table className="compare-table">
          <caption className="compare-caption">
            {names[0]} (A) and {names[1]} (B), each figure with what it is a share of
          </caption>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col">A: {names[0]}</th>
              <th scope="col">B: {names[1]}</th>
              <th scope="col">Difference A − B</th>
              {ratio && <th scope="col">Ratio: A's share ÷ B's share</th>}
              <th scope="col">
                <span className="compare-hidden">Selection step</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  <span className="compare-measure">{row.measure}</span>
                  {row.detail && <span className="compare-detail">{row.detail}</span>}
                </th>
                <td>{row.a}</td>
                <td>{row.b}</td>
                <td>{row.difference ?? <span className="compare-muted" aria-label="Counts are not compared">—</span>}</td>
                {ratio && <td>{row.ratio ?? <span className="compare-muted" aria-label="No ratio">—</span>}</td>}
                <td>
                  {row.inspect && onInspect && (
                    <button type="button" className="compare-step" onClick={() => row.inspect && onInspect({ columnIndex: answer.context_column_index, ...row.inspect })}>
                      Inspect the cases first recorded with {row.inspect.label}
                    </button>
                  )}
                  {row.step && (
                    <button
                      type="button"
                      className="compare-step"
                      disabled={waitingFor !== undefined}
                      aria-describedby={waitingFor}
                      onClick={() => row.step && onStep(row.step.predicate)}
                    >
                      {row.step.label}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="compare-notice" role="note" aria-label="Overlap">
        {overlapSentences(answer.pair_support, names, kind).map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
      </div>
      <ProfileNotes profile={answer.context_profile} columnName={columnName} />
      {shown.kind === "periods" && <ExposureNote answer={shown.answer} minimum={shown.request.definition.minimum_followup_hours} />}
      <p className="compare-muted">
        These figures say how {names[0]} and {names[1]} differ. They do not say why they differ. They are exact counts of this log, not tests of
        significance, and no value here is a cause.
      </p>
    </>
  );
}

function roleDefinitions(shown: ShownComparison): string {
  if (shown.kind === "periods") {
    const { target, reference, minimum_followup_hours: minimum, endpoint_activity: endpoint } = shown.request.definition;
    const window = (period: typeof target) => `${period.window.start_inclusive.replace("T00:00:00Z", "").replace("T00:00:00", "")} to ${period.window.end_exclusive.replace("T00:00:00Z", "").replace("T00:00:00", "")} (end excluded)`;
    return (
      `Periods take cases by the start of their first record: A from ${window(target)}, B from ${window(reference)}. Both are measured the same way, to the ` +
      `snapshot cutoff stored with the preparation, with a minimum follow-up of ${hoursText(minimum)}${endpoint ? ` and the recorded activity “${endpoint}”` : ""}, and the same ` +
      "context. Each case keeps its whole history, also after its period."
    );
  }
  const definition = shown.request.definition;
  if (definition.mode === "selection_partition") {
    const included = definition.target_side === "kept";
    const clause = definition.predicates.map(stepWording).join("; and ");
    const absent = definition.predicates.length === 1 && definition.predicates[0].kind === "contains_activity" ? definition.predicates[0].activity : null;
    return (
      `A is the target and B the reference: A holds the cases of the parent the clause ${included ? "includes" : "excludes"}, B those it ${included ? "excludes" : "includes"}, ` +
      `and the cases it cannot evaluate are in neither. The clause: ${clause}.` +
      (absent === null ? "" : ` “No recorded “${absent}”” says only that the export holds no record of it: not that the case is open or unresolved.`)
    );
  }
  return `A: ${groupWording(definition.target.definition)}. B: ${groupWording(definition.reference.definition)}.`;
}

function cohortRows(answer: GroupComparisonAnswer | PeriodComparisonAnswer): Row[] {
  const { parent, target, reference, context_profile: profile } = answer;
  const periods = "case_start_basis" in answer;
  const noun = periods ? "period" : "group";
  const member = `in the ${noun}`;
  return [
    {
      key: "included",
      measure: periods ? "Cases started in the period" : "Cases in the group",
      detail: `of the ${countOf(parent.case_count, "case")} of the parent`,
      a: partOf(target.included, parent, "of the parent"),
      b: partOf(reference.included, parent, "of the parent"),
      difference: null,
    },
    {
      key: "unevaluable",
      measure: "Not evaluable for membership",
      detail: `cases of the parent in neither the ${noun} nor outside it`,
      a: partOf(target.unevaluable, parent, "of the parent"),
      b: partOf(reference.unevaluable, parent, "of the parent"),
      difference: null,
    },
    {
      key: "readable",
      measure: "First record readable",
      detail: "the denominator of every opening share below",
      a: ofIncluded(profile.target_evaluable, target.included, member),
      b: ofIncluded(profile.reference_evaluable, reference.included, member),
      difference: null,
    },
  ];
}

/** "2 of 3 incidents in the group": a supplied part of the supplied incidents of one side. */
function ofIncluded(part: PopulationSupport, included: PopulationSupport, member: string): string {
  return `${part.case_count} of ${countOf(included.case_count, "case")} ${member}`;
}

function periodRows(answer: PeriodComparisonAnswer, minimum: number): Row[] {
  const rows: Row[] = [
    {
      key: "adequate",
      measure: `Followed for at least ${hoursText(minimum)}`,
      detail: "from the case's start to the snapshot cutoff",
      a: ofIncluded(answer.target.exposure.adequate, answer.target.included, "in the period"),
      b: ofIncluded(answer.reference.exposure.adequate, answer.reference.included, "in the period"),
      difference: null,
    },
    {
      key: "inadequate",
      measure: `Followed for less than ${hoursText(minimum)}`,
      detail: "not fully observed: a later record could still come",
      a: ofIncluded(answer.target.exposure.inadequate, answer.target.included, "in the period"),
      b: ofIncluded(answer.reference.exposure.inadequate, answer.reference.included, "in the period"),
      difference: null,
    },
  ];
  const endpoint = endpointRow(answer.target, answer.reference);
  if (endpoint) rows.push(endpoint);
  const missing = missingEndpointRow(answer.target, answer.reference);
  if (missing) rows.push(missing);
  return rows;
}

function endpointRow(target: PeriodCohort, reference: PeriodCohort): Row | null {
  if (!target.endpoint_coverage || !reference.endpoint_coverage) return null;
  const activity = target.endpoint_coverage.activity;
  return {
    key: "endpoint",
    measure: `“${activity}” recorded`,
    detail: "anywhere in the complete history; not a business outcome",
    a: ofIncluded(target.endpoint_coverage.recorded, target.included, "in the period"),
    b: ofIncluded(reference.endpoint_coverage.recorded, reference.included, "in the period"),
    difference: null,
    step: { predicate: { kind: "contains_activity", activity, negate: false }, label: `Keep cases that contain “${activity}”` },
  };
}

function missingEndpointRow(target: PeriodCohort, reference: PeriodCohort): Row | null {
  if (!target.endpoint_coverage || !reference.endpoint_coverage) return null;
  const activity = target.endpoint_coverage.activity;
  return {
    key: "endpoint-missing",
    measure: `No recorded “${activity}”`,
    detail: "in the export at its cutoff: not a verdict that the case is unfinished",
    a: ofIncluded(target.endpoint_coverage.not_recorded, target.included, "in the period"),
    b: ofIncluded(reference.endpoint_coverage.not_recorded, reference.included, "in the period"),
    difference: null,
  };
}

function profileRows(answer: GroupComparisonAnswer | PeriodComparisonAnswer, columnName: string): Row[] {
  const names: [string, string] = [answer.target.name, answer.reference.name];
  return answer.context_profile.categories.map((category: CategoryComparison) => {
    const value = valueText(category.value);
    const opened = category.value === null ? `First recorded with ${columnName} not recorded` : `First recorded with ${columnName} ${value}`;
    return {
      key: `value-${JSON.stringify(category.value)}`,
      measure: opened,
      detail: `parent: ${shareText(category.parent)}`,
      a: shareText(category.target),
      b: shareText(category.reference),
      difference: differenceCell(category, names),
      ratio: ratioCell(category, names),
      inspect: { value: category.value, label: category.value === null ? `${columnName} not recorded` : `${columnName} ${value}` },
      step: {
        predicate: {
          kind: "opening_attribute_equals",
          column_index: answer.context_column_index,
          value: category.value,
          negate: false,
          anchor_policy: contextPolicy,
        },
        label: category.value === null ? `Keep cases first recorded with ${columnName} not recorded` : `Keep cases first recorded with ${columnName} ${value}`,
      },
    };
  });
}

function ProfileNotes({ profile, columnName }: { profile: ContextProfile; columnName: string }) {
  const notes: string[] = [];
  if (profile.parent_unevaluable.case_count > 0) {
    const count = profile.parent_unevaluable.case_count;
    notes.push(
      `${countOf(count, "case")} of the parent ${count === 1 ? "has" : "have"} no readable first record, as ${count === 1 ? "its" : "their"} order is not known; ${count === 1 ? "it is" : "they are"} in no share.`,
    );
  }
  notes.push(
    `Each case has exactly one first recorded ${columnName}, so the shares of a side add up. Values ever recorded later would overlap and not add up; they are not offered here.`,
  );
  if (profile.parent_fixed.status === "fixed") {
    notes.push(`${columnName} is fixed in the parent: every case of the parent was first recorded with ${columnName} ${valueText(profile.parent_fixed.value)}, so this column cannot tell the groups apart.`);
  } else if (profile.parent_fixed.status === "varying") {
    notes.push(`${columnName} varies in the parent: its cases were first recorded with more than one value.`);
  }
  if (notes.length === 0) return null;
  return (
    <div className="compare-notes">
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </div>
  );
}

function ExposureNote({ answer, minimum }: { answer: PeriodComparisonAnswer; minimum: number }) {
  const clock = answer.followup_clock;
  const short = (cohort: PeriodCohort) =>
    `${cohort.name}: ${cohort.exposure.inadequate.case_count} of ${countOf(cohort.included.case_count, "case")} followed for less than ${hoursText(minimum)}`;
  return (
    <div className="compare-notice" role="note" aria-label="Exposure">
      <p>
        Follow-up runs from each case's start to the snapshot cutoff stored with this preparation, {cutoffText(clock)}, not to the last record
        in the source. {short(answer.target)}; {short(answer.reference)}. An activity not yet recorded for a case followed only briefly may
        still be recorded later.
      </p>
      {clock.clock_limitation && <p>{clock.clock_limitation}</p>}
    </div>
  );
}

function ComparisonProblemNotice({ title, problem, onRetry }: { title: string; problem: ComparisonProblem; onRetry: () => void }) {
  const text = describeComparisonProblem(problem);
  const retryable = problem.kind !== "refusal" || problem.refusal.retryable;
  return (
    <div className="compare-problem" role="alert">
      <p className="compare-problem-title">{title}</p>
      <p>{text.message}</p>
      <p>
        <span className="compare-label">What to do</span> {text.remedy}
      </p>
      {retryable && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** The parent of the comparisons: every incident, or the parent frozen after retained steps, with the way back to every incident. */
function ParentLine({ filename, every, parent, onRebase }: { filename: string; every: string; parent: FrozenParent | null; onRebase: () => void }) {
  if (parent === null) return <p className="compare-muted">In {filename}: the parent is every case, {every}.</p>;
  const retained = parent.label ?? (parent.retained.length === 0 ? "the investigation's parent" : `kept by ${parent.retained.map(stepWording).join("; and ")}`);
  return (
    <div className="compare-parent" role="note" aria-label="Parent">
      <p>
        In {filename}: the parent P is frozen (parent {parent.revision}): {countOf(parent.count, "case")} {retained}.
        {parent.eligibilityUnknown > 0 &&
          ` ${countOf(parent.eligibilityUnknown, "case")} whose eligibility is unknown, as a step could not evaluate ${parent.eligibilityUnknown === 1 ? "it" : "them"}, ${parent.eligibilityUnknown === 1 ? "is" : "are"} outside it.`}
      </p>
      <button type="button" onClick={onRebase}>
        Use every case as the parent
      </button>
    </div>
  );
}

/** A side without an incident cannot be described: the ways on are said. */
function EmptySide({ shown, frozen, onRebase, onSwap, onShowInvestigation }: { shown: ShownComparison; frozen: boolean; onRebase: () => void; onSwap: () => void; onShowInvestigation: () => void }) {
  const empty = [shown.answer.target, shown.answer.reference].filter((cohort) => cohort.included.case_count === 0);
  if (empty.length === 0) return null;
  return (
    <div className="compare-problem" role="note" aria-label="Empty side">
      <p className="compare-problem-title">{empty.map((cohort) => cohort.name).join(" and ")} {empty.length === 1 ? "has" : "have"} no case in this parent.</p>
      <p>Choose another clause in Investigations{frozen ? ", or compare in every case instead of the frozen parent" : ""}; exchanging A and B changes only which side is the target.</p>
      <div className="compare-actions">
        <button type="button" onClick={onShowInvestigation}>Choose another clause in Investigations</button>
        {frozen && <button type="button" onClick={onRebase}>Use every case as the parent</button>}
        <button type="button" onClick={onSwap}>Exchange A and B</button>
      </div>
    </div>
  );
}

type SideChoice = "target" | "reference" | "both";

/**
 * The incidents of A, of B or of both, each opened with its complete history in the population of its side; the
 * comparison stays shown, and returning gives the focus back to the incident's button.
 */
function SideIncidents({ shown, investigation, inspected = null }: { shown: ShownComparison; investigation: ImportedInvestigationCoordinator; inspected?: InspectedValue | null }) {
  const [side, setSide] = useState<SideChoice | null>(null);
  // The incidents of each side first recorded with an inspected value, as the local service selects them in that side.
  const [valued, setValued] = useState<{ label: string; target: string[]; reference: string[] } | { label: string; failed: string } | null>(null);
  useEffect(() => {
    if (inspected === null) return;
    const controller = new AbortController();
    const step: SelectionPredicate = { kind: "opening_attribute_equals", column_index: inspected.columnIndex, value: inspected.value, negate: false, anchor_policy: contextPolicy };
    setSide("both");
    Promise.all([shown.answer.target, shown.answer.reference].map((cohort) => investigation.keptBy([step], controller.signal, cohort.included.case_ids))).then(([a, b]) => {
      if (controller.signal.aborted) return;
      setValued(a.ok && b.ok ? { label: inspected.label, target: a.keptIds, reference: b.keptIds } : { label: inspected.label, failed: "The cases of this value could not be selected; try again." });
    });
    return () => controller.abort();
  }, [inspected, shown, investigation]);
  const [open, setOpen] = useState<{ caseId: string; role: Role; loaded: { ok: true; answer: ImportedCaseEvidenceAnswer } | { ok: false; message: string } | null } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const { target, reference } = shown.answer;
  const inTarget = new Set(target.included.case_ids);
  const inReference = new Set(reference.included.case_ids);
  const ofValue = valued !== null && "target" in valued ? { target: new Set(valued.target), reference: new Set(valued.reference) } : null;
  const listed = (side === null ? [] : side === "target" ? target.included.case_ids : side === "reference" ? reference.included.case_ids
    : [...new Set([...target.included.case_ids, ...reference.included.case_ids])].sort())
    .filter((caseId) => ofValue === null || ofValue.target.has(caseId) || ofValue.reference.has(caseId));
  useEffect(() => {
    if (open?.loaded) heading.current?.focus();
  }, [open?.loaded]);
  async function openCase(caseId: string, role: Role, element: HTMLElement) {
    opener.current = element;
    setOpen({ caseId, role, loaded: null });
    const identity = role === "target" ? target.identity : reference.identity;
    const outcome = await investigation.evidenceIn(identity, caseId, new AbortController().signal);
    setOpen({ caseId, role, loaded: outcome.ok ? outcome : { ok: false, message: describeImportProblem(outcome.problem).message } });
  }
  function close() {
    setOpen(null);
    const element = opener.current;
    requestAnimationFrame(() => element?.focus());
  }
  const roleName = (role: Role) => `${role === "target" ? "A" : "B"}, ${role === "target" ? target.name : reference.name}`;
  return (
    <section className="compare-sides" aria-labelledby="compare-sides-title">
      <h4 id="compare-sides-title">Cases of the sides</h4>
      <div className="compare-modes" role="group" aria-label="Inspect the cases of">
        {(["target", "reference", "both"] as const).map((choice) => (
          <button key={choice} type="button" aria-pressed={side === choice} onClick={() => setSide(side === choice ? null : choice)}>
            {choice === "target" ? `A: ${target.name}` : choice === "reference" ? `B: ${reference.name}` : "Both"}
          </button>
        ))}
      </div>
      {valued !== null && (
        <p className="compare-muted">
          {"failed" in valued ? valued.failed : `Listed: the cases first recorded with ${valued.label}, ${valued.target.length} of A and ${valued.reference.length} of B. Listing them takes no step.`}{" "}
          <button type="button" className="link-button" onClick={() => setValued(null)}>
            List every case of the sides
          </button>
        </p>
      )}
      {side !== null && (
        <ul className="compare-side-list" aria-label={side === "both" ? "Cases of A and B" : `Cases of ${roleName(side)}`}>
          {listed.map((caseId) => {
            const role: Role = inTarget.has(caseId) ? "target" : "reference";
            const of = inTarget.has(caseId) && inReference.has(caseId) ? "A and B" : role === "target" ? "A" : "B";
            return (
              <li key={caseId}>
                <span className="identifier">{caseId}</span> · {of}{" "}
                <button type="button" className="link-button" onClick={(event) => void openCase(caseId, role, event.currentTarget)}>
                  Open {caseId}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <section className="compare-history" aria-labelledby="compare-history-title" onKeyDown={(event) => event.key === "Escape" && close()}>
          <h4 id="compare-history-title" tabIndex={-1} ref={heading}>
            Case <span className="identifier">{open.caseId}</span>, of {roleName(open.role)}
          </h4>
          <p className="compare-muted">Read in the population of its side; the comparison and its parent stay as they are. Escape returns.</p>
          {open.loaded === null ? (
            <p className="working-text">Reading every record of {open.caseId}…</p>
          ) : open.loaded.ok ? (
            <RecordsTable answer={open.loaded.answer} />
          ) : (
            <p role="alert">{open.loaded.message}</p>
          )}
          <button type="button" onClick={close}>
            Return to the comparison
          </button>
        </section>
      )}
    </section>
  );
}

/**
 * Compares within one stratum: the incidents of the parent first recorded with one value of a context column, for
 * example one priority. The stratum is a frozen parent like any other, said in the parent line, and undone the same way.
 */
function StratumChoice({ coordinator, investigation, openings, parentCaseIds }: {
  coordinator: CompareCoordinator; investigation: ImportedInvestigationCoordinator; openings: OpeningChoice[]; parentCaseIds: string[] | null;
}) {
  const [column, setColumn] = useState<number | null>(null);
  const [value, setValue] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "working" | string>("idle");
  const opening = openings.find((item) => item.index === column) ?? null;
  if (openings.length === 0) return null;
  async function within() {
    if (opening === null || value === null) return;
    const chosen = opening.values[value];
    const step: SelectionPredicate = { kind: "opening_attribute_equals", column_index: opening.index, value: chosen, negate: false, anchor_policy: contextPolicy };
    setState("working");
    const kept = await investigation.keptBy([step], new AbortController().signal, parentCaseIds ?? undefined);
    if (!kept.ok) {
      setState(kept.problem.kind === "refusal" ? kept.problem.refusal.message : "The stratum could not be selected; try again.");
      return;
    }
    setState("idle");
    coordinator.freeze({ caseIds: kept.keptIds, retained: [step], count: kept.keptIds.length, eligibilityUnknown: kept.unevaluable });
  }
  return (
    <fieldset className="compare-stratum">
      <legend className="compare-label">Within a stratum</legend>
      <p className="compare-muted">
        Compare only the cases first recorded with one value, for example one priority or one service. A difference within a stratum is still an
        association of this log: not the quality of a team, and not a cause.
      </p>
      <label>
        Stratum column
        <select value={column ?? ""} onChange={(event) => { setColumn(event.target.value === "" ? null : Number(event.target.value)); setValue(null); }}>
          <option value="">Choose a column</option>
          {openings.map((item) => (
            <option key={item.index} value={item.index}>{item.name}</option>
          ))}
        </select>
      </label>
      {opening && (
        <label>
          Stratum value
          <select value={value ?? ""} onChange={(event) => setValue(event.target.value === "" ? null : Number(event.target.value))}>
            <option value="">Choose a value</option>
            {opening.values.map((item, index) => (
              <option key={index} value={index}>{item === null ? NOT_RECORDED : item}</option>
            ))}
          </select>
        </label>
      )}
      <button type="button" disabled={opening === null || value === null || state === "working"} onClick={() => void within()}>
        Compare within this stratum
      </button>
      {state !== "idle" && state !== "working" && <p role="alert">{state}</p>}
    </fieldset>
  );
}

/**
 * Follow-up of two periods: a newer period may not be observed as long as an older one. The restriction to incidents
 * followed for at least the minimum is declared as the parent; where coverage is not comparable, "no conclusion" can be
 * kept with the comparison. No survival estimate is made and no difference is called an improvement.
 */
function FollowupChoice({ shown, restricted, onRestrict, onRebase }: {
  shown: Extract<ShownComparison, { kind: "periods" }>; restricted: boolean;
  onRestrict: (parent: Omit<FrozenParent, "revision">) => void; onRebase: () => void;
}) {
  const [kept, setKept] = useState(false);
  const { target, reference } = shown.answer;
  const minimum = shown.request.definition.minimum_followup_hours;
  const share = (cohort: PeriodCohort) => (cohort.included.case_count === 0 ? 0 : cohort.exposure.inadequate.case_count / cohort.included.case_count);
  const comparable = target.exposure.inadequate.case_count === 0 && reference.exposure.inadequate.case_count === 0;
  const adequate = [...target.exposure.adequate.case_ids, ...reference.exposure.adequate.case_ids];
  return (
    <div className="compare-notice" role="note" aria-label="Follow-up">
      {comparable ? (
        <p>Every case of both periods was followed for at least {hoursText(minimum)} before the snapshot cutoff.</p>
      ) : (
        <p>
          Coverage is not comparable: {target.exposure.inadequate.case_count} of {countOf(target.included.case_count, "case")} of {target.name} (
          {Math.round(share(target) * 100)} %) and {reference.exposure.inadequate.case_count} of {countOf(reference.included.case_count, "case")} of{" "}
          {reference.name} ({Math.round(share(reference) * 100)} %) were followed for less than {hoursText(minimum)}. A difference in what is recorded may be a
          difference in follow-up.
        </p>
      )}
      {minimum <= 0 ? (
        <p className="compare-muted">Choose a minimum follow-up above 0 hours to restrict the periods to cases observed at least that long.</p>
      ) : restricted ? (
        <button type="button" onClick={onRebase}>Compare every case of the periods again</button>
      ) : (
        <button type="button" disabled={comparable} onClick={() => onRestrict({ caseIds: [...new Set(adequate)].sort(), retained: [], count: new Set(adequate).size, eligibilityUnknown: 0,
          label: `followed for at least ${hoursText(minimum)} to the snapshot cutoff` })}>
          Keep only cases followed for at least {hoursText(minimum)}
        </button>
      )}
      {!comparable && (
        kept ? (
          <p role="status">Kept: no conclusion about a change between {target.name} and {reference.name}, as their follow-up is not comparable.</p>
        ) : (
          <button type="button" onClick={() => setKept(true)}>Keep this as no conclusion</button>
        )
      )}
      <p className="compare-muted">No survival estimate is made here, and no difference between the periods is an improvement or a decline.</p>
    </div>
  );
}
