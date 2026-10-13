import { type ReactNode, useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
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
import { stepWording, supportText } from "../map/wording";
import type { ComparisonProblem } from "./client";
import {
  type CompareBasis,
  type CompareCoordinator,
  type CompareDraft,
  contextPolicy,
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
function basisOf(answer: ImportedPopulationAnswer): CompareBasis {
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
          <p>
            Comparisons are made in the incidents of a source read in the Data area. Open the incidents of a source there, for example of a
            packaged example added to a workspace, then come back here.
          </p>
          <button type="button" onClick={onShowData}>
            Go to the Data area
          </button>
        </div>
      </main>
    );
  }

  const { draft, comparison } = state;
  const shown = comparison.phase === "idle" ? null : comparison.shown;
  const selection = shownSelection(investigated.selection);
  const activities = investigated.parentGraph?.nodes.map((node) => node.label) ?? [];

  function addStep(step: SelectionPredicate) {
    investigation.addStep(step);
    setAdded(step);
  }

  return (
    <main className="compare" aria-labelledby="compare-title">
      <div className="compare-head">
        <h2 id="compare-title" className="compare-title">
          Compare
        </h2>
        <p className="compare-muted">
          In {population.source.filename}: the parent is every incident, {supportText(population.population)}.
        </p>
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
            <GroupsSetup coordinator={coordinator} draft={draft} selection={selection} />
          ) : (
            <PeriodsSetup coordinator={coordinator} draft={draft} clock={state.basis.clock} activities={activities} />
          )}
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
          {shown && <ComparisonTable shown={shown} columnName={columnName(shown.answer.context_column_index)} onStep={addStep} />}
        </section>
      </div>
    </main>
  );
}

interface GroupsSetupProps {
  coordinator: CompareCoordinator;
  draft: CompareDraft;
  selection: ReturnType<typeof shownSelection>;
}

function GroupsSetup({ coordinator, draft, selection }: GroupsSetupProps) {
  const steps = selection?.steps ?? [];
  return (
    <>
      <div className="compare-selection">
        <p>
          <span className="compare-label">Current selection</span>{" "}
          {selection === null
            ? "not answered yet"
            : steps.length === 0
              ? `no step: keeps every incident, ${supportText(selection.answer.kept)}`
              : `${steps.map(stepWording).join("; and ")}. Kept ${supportText(selection.answer.kept)}; removed ${supportText(selection.answer.removed)}; not evaluable ${supportText(selection.answer.unevaluable)}.`}
        </p>
        <button
          type="button"
          disabled={selection === null || steps.length === 0}
          onClick={() =>
            selection &&
            coordinator.splitSelection(selection.steps, {
              kept: selection.answer.kept,
              removed: selection.answer.removed,
              unevaluable: selection.answer.unevaluable,
            })
          }
        >
          Kept against removed
        </button>
        {selection !== null && steps.length === 0 && (
          <p className="compare-muted">Add a step to the selection in Investigations to compare its kept and removed incidents.</p>
        )}
      </div>
      <div className="compare-groups">
        {(["target", "reference"] as const).map((role) => (
          <GroupSlot key={role} role={role} coordinator={coordinator} draft={draft} selection={selection} />
        ))}
      </div>
      <button type="button" onClick={() => coordinator.swap()}>
        Exchange A and B
      </button>
    </>
  );
}

function GroupSlot({ role, coordinator, draft, selection }: { role: Role } & GroupsSetupProps) {
  const letter = letters[role];
  const nameId = useId();
  const idsId = useId();
  const [ids, setIds] = useState("");
  const group = draft.groups[role];
  const listed = [...new Set(ids.split(/[\s,;]+/).filter((id) => id !== ""))];
  let description: ReactNode;
  if (draft.split) {
    const side = role === "target" ? draft.split.targetSide : draft.split.targetSide === "kept" ? "removed" : "kept";
    const support = side === "kept" ? draft.split.taken.kept : draft.split.taken.removed;
    description = (
      <>
        The {side} incidents of the selection: {draft.split.predicates.map(stepWording).join("; and ")}. When it was taken it {side}{" "}
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
      <button
        type="button"
        disabled={selection === null}
        onClick={() => selection && coordinator.takeSelection(role, selection.steps, selection.answer.kept)}
      >
        Take the current selection as {letter}
      </button>
      <details className="compare-ids">
        <summary>List incident ids for {letter}</summary>
        <label htmlFor={idsId} className="compare-label">
          Incident ids, separated by spaces, commas or new lines
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
        An incident belongs to a period when its first record falls on one of its days ({clock === "wall_clock" ? "days as recorded" : "days in UTC"}
        ). Every record of the incident counts, also those after the period.
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
  step?: { predicate: SelectionPredicate; label: string };
}

function ComparisonTable({ shown, columnName, onStep }: { shown: ShownComparison; columnName: string; onStep: (step: SelectionPredicate) => void }) {
  const answer = shown.answer;
  const names: [string, string] = [answer.target.name, answer.reference.name];
  const rows: Row[] = [...cohortRows(answer)];
  if (shown.kind === "periods") rows.push(...periodRows(shown.answer, shown.request.definition.minimum_followup_hours));
  rows.push(...profileRows(answer, columnName));
  const kind = shown.kind === "periods" ? "period" : "group";
  return (
    <>
      <p className="compare-roles">
        <strong>A</strong> is {kind} {names[0]}; <strong>B</strong> is {kind} {names[1]}. {roleDefinitions(shown)}
      </p>
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
                <td>
                  {row.step && (
                    <button type="button" className="compare-step" onClick={() => row.step && onStep(row.step.predicate)}>
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
        {overlapSentences(answer.pair_support, names).map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
      </div>
      <ProfileNotes profile={answer.context_profile} columnName={columnName} />
      {shown.kind === "periods" && <ExposureNote answer={shown.answer} minimum={shown.request.definition.minimum_followup_hours} />}
      <p className="compare-muted">
        These figures say how {names[0]} and {names[1]} differ. They do not say why they differ.
      </p>
    </>
  );
}

function roleDefinitions(shown: ShownComparison): string {
  if (shown.kind === "periods") return "Periods take incidents by the start of their first record.";
  const definition = shown.request.definition;
  if (definition.mode === "selection_partition") {
    const target = definition.target_side;
    const reference = target === "kept" ? "removed" : "kept";
    return `A holds the ${target} and B the ${reference} incidents of the selection: ${definition.predicates.map(stepWording).join("; and ")}.`;
  }
  return `A: ${groupWording(definition.target.definition)}. B: ${groupWording(definition.reference.definition)}.`;
}

function cohortRows(answer: GroupComparisonAnswer | PeriodComparisonAnswer): Row[] {
  const { parent, target, reference, context_profile: profile } = answer;
  const periods = "case_start_basis" in answer;
  const member = periods ? "in the period" : "in the group";
  return [
    {
      key: "included",
      measure: periods ? "Incidents started in the period" : "Incidents in the group",
      detail: `of the ${countOf(parent.case_count, "incident")} of the parent`,
      a: partOf(target.included, parent, "of the parent"),
      b: partOf(reference.included, parent, "of the parent"),
      difference: null,
    },
    {
      key: "unevaluable",
      measure: "Not evaluable for membership",
      detail: "incidents of the parent in neither the group nor outside it",
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
  return `${part.case_count} of ${countOf(included.case_count, "incident")} ${member}`;
}

function periodRows(answer: PeriodComparisonAnswer, minimum: number): Row[] {
  const rows: Row[] = [
    {
      key: "adequate",
      measure: `Followed for at least ${hoursText(minimum)}`,
      detail: "from the incident's start to the snapshot cutoff",
      a: ofIncluded(answer.target.exposure.adequate, answer.target.included, "in the period"),
      b: ofIncluded(answer.reference.exposure.adequate, answer.reference.included, "in the period"),
      difference: null,
    },
  ];
  const endpoint = endpointRow(answer.target, answer.reference);
  if (endpoint) rows.push(endpoint);
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
    step: { predicate: { kind: "contains_activity", activity, negate: false }, label: `Keep incidents that contain “${activity}”` },
  };
}

function profileRows(answer: GroupComparisonAnswer | PeriodComparisonAnswer, columnName: string): Row[] {
  const names: [string, string] = [answer.target.name, answer.reference.name];
  return answer.context_profile.categories.map((category: CategoryComparison) => {
    const value = valueText(category.value);
    const opened = category.value === null ? `Opened with ${columnName} not recorded` : `Opened with ${columnName} ${value}`;
    return {
      key: `value-${JSON.stringify(category.value)}`,
      measure: opened,
      detail: `parent: ${shareText(category.parent)}`,
      a: shareText(category.target),
      b: shareText(category.reference),
      difference: differenceCell(category, names),
      step: {
        predicate: {
          kind: "opening_attribute_equals",
          column_index: answer.context_column_index,
          value: category.value,
          negate: false,
          anchor_policy: contextPolicy,
        },
        label: category.value === null ? `Keep incidents opened with ${columnName} not recorded` : `Keep incidents opened with ${columnName} ${value}`,
      },
    };
  });
}

function ProfileNotes({ profile, columnName }: { profile: ContextProfile; columnName: string }) {
  const notes: string[] = [];
  if (profile.parent_unevaluable.case_count > 0) {
    const count = profile.parent_unevaluable.case_count;
    notes.push(
      `${countOf(count, "incident")} of the parent ${count === 1 ? "has" : "have"} no readable first record, as ${count === 1 ? "its" : "their"} order is not known; ${count === 1 ? "it is" : "they are"} in no share.`,
    );
  }
  if (profile.parent_fixed.status === "fixed") {
    notes.push(`Every incident of the parent opened with ${columnName} ${valueText(profile.parent_fixed.value)}, so this column cannot tell the groups apart.`);
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
    `${cohort.name}: ${cohort.exposure.inadequate.case_count} of ${countOf(cohort.included.case_count, "incident")} followed for less than ${hoursText(minimum)}`;
  return (
    <div className="compare-notice" role="note" aria-label="Exposure">
      <p>
        Follow-up runs from each incident's start to the snapshot cutoff stored with this preparation, {cutoffText(clock)}, not to the last record
        in the source. {short(answer.target)}; {short(answer.reference)}. An activity not yet recorded for an incident followed only briefly may
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
