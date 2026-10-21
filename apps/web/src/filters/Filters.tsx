import { type ReactNode, useId, useState } from "react";
import type { ImportedPopulationAnswer } from "../generated/imports";
import type { SelectionPredicate } from "../generated/selection";
import type { OpeningContextAnswer } from "../views/messages";
import type { ViewState } from "../imported/coordinator";
import { StepPreviewLine, type StepPreviewer } from "../map/StepPreviewLine";
import { stepWording } from "../map/wording";
import "./filters.css";

export interface RecordedRange {
  timestamp_kind: "utc_instant" | "wall_clock";
  earliest_recorded_timestamp: string;
  latest_recorded_timestamp: string;
}

interface FiltersProps {
  population: ImportedPopulationAnswer;
  parentIds: readonly string[] | null;
  opening: ViewState<OpeningContextAnswer>;
  onStep: (step: SelectionPredicate) => void;
  /** Counts what a filter would keep before it is taken; with it, a filter is previewed first and taken on request. */
  previewStep?: StepPreviewer;
  range?: RecordedRange | null;
  rangeProblem?: string;
  waitingFor?: string;
  /** Shows only the form of one kind of step, open and without the list of the others, as "+ Add step" does. */
  only?: StepKind;
}

/** The kinds of step "+ Add step" offers, with the words of each. */
export const STEP_KINDS = {
  numbers: "Incident numbers",
  time: "Recorded time",
  range: "A range of records, span or longest gap",
  period: "First record in a period",
  context: "Context values",
  number: "A range of a number in a context column",
} as const;
export type StepKind = keyof typeof STEP_KINDS;

const openingPolicy = "incident.context.first_record_in_declared_order.v1";

type RangeMeasure = "raw_record_count" | "observed_span_hours" | "maximum_adjacent_raw_gap_hours";

/** Each measure a range is taken on: its name, its unit, and which incidents have it. */
const RANGE_MEASURES: Record<RangeMeasure, { name: string; unit: string; has: string }> = {
  raw_record_count: {
    name: "Number of records",
    unit: "records",
    has: "Every incident has a number of records; records without an activity label count.",
  },
  observed_span_hours: {
    name: "Recorded span, first to last recorded time",
    unit: "hours",
    has: "An incident whose order is not known has no recorded span: it is not evaluable and is counted apart, neither kept nor removed.",
  },
  maximum_adjacent_raw_gap_hours: {
    name: "Longest gap between two records",
    unit: "hours",
    has: "An incident whose order is not known, or with one record, has no longest gap: it is not evaluable and is counted apart, neither kept nor removed.",
  },
};

/** The range entered as a step, or why it cannot be one. */
export function rangeStep(measure: RangeMeasure, low: string, high: string, negate: boolean): SelectionPredicate | string {
  const records = measure === "raw_record_count";
  const read = (text: string) => (text.trim() === "" ? null : Number(text));
  const minimum = read(low);
  const maximum = read(high);
  const valid = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0 && (!records || Number.isInteger(value));
  const kind = records ? "a whole number of records, zero or more" : "a finite number of hours, zero or more";
  if (!valid(minimum)) return `Enter the lower bound as ${kind}. Nothing was applied.`;
  if (maximum !== null && !valid(maximum)) return `Enter the upper bound as ${kind}, or leave it empty for no upper bound. Nothing was applied.`;
  if (maximum !== null && maximum < (minimum as number)) return "The upper bound is below the lower bound. Nothing was applied.";
  return { kind: "measure_between", measure, minimum: minimum as number, maximum, negate };
}

/** Typed filters keep complete incidents; only the local service evaluates membership. */
export function Filters({ population, parentIds, opening, onStep, previewStep, range, rangeProblem, waitingFor, only }: FiltersProps) {
  const title = useId();
  const previewId = useId();
  // The filter previewed and not yet taken; a new filter or a taken one replaces it.
  const [pending, setPending] = useState<SelectionPredicate | null>(null);
  const [ids, setIds] = useState("");
  const [measure, setMeasure] = useState<"observed_span_at_least" | "max_raw_gap_at_least">("observed_span_at_least");
  const [hours, setHours] = useState("");
  const [ranged, setRanged] = useState<RangeMeasure>("raw_record_count");
  const [low, setLow] = useState("");
  const [high, setHigh] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [column, setColumn] = useState(String(population.preparation.mapping.context_columns[0] ?? ""));
  const [anchor, setAnchor] = useState<"opening" | "any">("any");
  const [values, setValues] = useState("");
  const [suggested, setSuggested] = useState<string[]>([]);
  const [exact, setExact] = useState("");
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parent = new Set(parentIds ?? population.population.case_ids);
  const known = new Set(population.population.case_ids);
  const columns = opening.phase === "ready" ? opening.answer.opening_context.columns : [];
  const selectedColumn = columns.find((item) => String(item.column_index) === column);
  const clock = population.preparation.policies.time.id === "incident.time.wall_clock_as_recorded.v1" ? "Recorded wall clock" : "UTC";
  const minDate = range?.earliest_recorded_timestamp.slice(0, 10);
  const maxDate = range?.latest_recorded_timestamp.slice(0, 10);
  const lastDate = maxDate ? new Date(maxDate + "T00:00:00Z") : null;
  if (lastDate) lastDate.setUTCDate(lastDate.getUTCDate() + 1);
  const maximumEnd = lastDate?.toISOString().slice(0, 19);
  const submit = (step: SelectionPredicate) => {
    setError(null);
    if (previewStep) setPending(step);
    else onStep(step);
  };
  const takeRange = (negate: boolean) => {
    const step = rangeStep(ranged, low, high, negate);
    if (typeof step === "string") setError(step);
    else submit(step);
  };

  return (
    <section className="incident-filters" aria-labelledby={title}>
      <h3 id={title} className={only ? "visually-hidden" : "view-title"}>{only ? STEP_KINDS[only] : "Filter whole incidents"}</h3>
      {!only && <p className="muted">Each filter adds a step inside the same parent. Every record of a kept incident remains available. Undo removes the last step.</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {pending && previewStep && (
        <div className="filter-preview" role="group" aria-label="Filter not yet taken">
          <p>{stepWording(pending)}</p>
          <StepPreviewLine id={previewId} step={pending} previewer={previewStep} />
          <button type="button" className="primary" disabled={waitingFor !== undefined} aria-describedby={[waitingFor, previewId].filter(Boolean).join(" ")}
            onClick={() => { onStep(pending); setPending(null); }}>
            Take this step
          </button>
          <button type="button" onClick={() => setPending(null)}>Change the filter</button>
        </div>
      )}
      <Section kind="numbers" only={only} open>
        <form onSubmit={(event) => {
          event.preventDefault();
          const entered = ids.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
          if (!entered.length) return setError("Enter at least one incident number, one per line.");
          if (new Set(entered).size !== entered.length) return setError("A number appears more than once. Remove the duplicate; nothing was applied.");
          const unknown = entered.filter((value) => !known.has(value));
          const outside = entered.filter((value) => known.has(value) && !parent.has(value));
          if (unknown.length) return setError(`Unknown incident numbers: ${unknown.join(", ")}. Correct them; nothing was applied.`);
          if (outside.length) return setError(`Outside this parent: ${outside.join(", ")}. Nothing was applied.`);
          submit({ kind: "case_id_in", case_ids: [entered[0], ...entered.slice(1)], negate: false });
        }}>
          <label>Exact incident numbers<textarea value={ids} onChange={(event) => setIds(event.target.value)} rows={3} spellCheck={false} /></label>
          <p className="muted">One number per line. The filter keeps any of these numbers, together with every existing step.</p>
          <button type="submit" disabled={waitingFor !== undefined} aria-describedby={waitingFor}>Keep these incidents</button>
        </form>
      </Section>
      <Section kind="time" only={only}>
        <form onSubmit={(event) => {
          event.preventDefault();
          const threshold = Number(hours);
          if (!hours.trim() || !Number.isFinite(threshold) || threshold < 0) return setError("Enter a finite number of hours, zero or more. Nothing was applied.");
          submit({ kind: measure, hours: threshold, negate: false });
        }}>
          <label>Measure<select value={measure} onChange={(event) => setMeasure(event.target.value as typeof measure)}><option value="observed_span_at_least">First to last recorded time</option><option value="max_raw_gap_at_least">Longest gap between records</option></select></label>
          <label>At least this many hours<input type="number" min="0" step="any" value={hours} onChange={(event) => setHours(event.target.value)} /></label>
          <p className="muted">Equality is included. Unknown chronology is not evaluable; an incident with one record has no adjacent gap. These are recorded times, not proof of working time or resolution.</p>
          <button type="submit" disabled={waitingFor !== undefined} aria-describedby={waitingFor}>Keep by recorded time</button>
        </form>
      </Section>
      <Section kind="range" only={only}>
        <form onSubmit={(event) => {
          event.preventDefault();
          takeRange(false);
        }}>
          <label>Measure of the range<select value={ranged} onChange={(event) => setRanged(event.target.value as RangeMeasure)}>
            {(Object.keys(RANGE_MEASURES) as RangeMeasure[]).map((key) => <option key={key} value={key}>{RANGE_MEASURES[key].name}</option>)}
          </select></label>
          <label>From, included ({RANGE_MEASURES[ranged].unit})<input type="number" min="0" step={ranged === "raw_record_count" ? "1" : "any"} value={low} onChange={(event) => setLow(event.target.value)} /></label>
          <label>To, included ({RANGE_MEASURES[ranged].unit}; empty for no upper bound)<input type="number" min="0" step={ranged === "raw_record_count" ? "1" : "any"} value={high} onChange={(event) => setHigh(event.target.value)} /></label>
          <p className="muted">Both bounds are included: an incident exactly at a bound is in the range. {RANGE_MEASURES[ranged].has} The range is one step; Undo takes it back.</p>
          <button type="submit" disabled={waitingFor !== undefined} aria-describedby={waitingFor}>Keep this range</button>
          <button type="button" disabled={waitingFor !== undefined} aria-describedby={waitingFor} onClick={() => takeRange(true)}>Remove this range</button>
        </form>
      </Section>
      <Section kind="period" only={only}>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!range) return setError("The recorded range is unavailable. Reopen the investigation or retry the range before applying a period.");
          if (!start || !end || start >= end) return setError("Choose a start earlier than the end. The end is excluded; nothing was applied.");
          const stamp = (value: string) => value.length === 16 ? value + ":00" : value;
          const first = stamp(start), last = stamp(end);
          if (first.slice(0, 10) < range.earliest_recorded_timestamp.slice(0, 10) || first.slice(0, 10) > range.latest_recorded_timestamp.slice(0, 10)) return setError("The start must be within the recorded dates of this parent. Nothing was applied.");
          if (maximumEnd && last > maximumEnd) return setError("Choose an end no later than the day after the last recorded date. Nothing was applied.");
          const window = clock === "UTC"
            ? { timestamp_kind: "utc_instant" as const, start_inclusive: first + "Z", end_exclusive: last + "Z" }
            : { timestamp_kind: "wall_clock" as const, start_inclusive: first, end_exclusive: last };
          submit({ kind: "case_start_in_window", window, negate: false });
        }}>
          <p className="muted">Clock: {clock}. {range ? `Recorded dates: ${minDate} to ${maxDate}.` : rangeProblem ?? "Reading the recorded range…"}</p>
          <label>First record from (included)<input type="datetime-local" step="1" min={minDate ? minDate + "T00:00" : undefined} max={maxDate ? maxDate + "T23:59:59" : undefined} value={start} onChange={(event) => setStart(event.target.value)} /></label>
          <label>Until (excluded)<input type="datetime-local" step="1" min={minDate ? minDate + "T00:00" : undefined} max={maximumEnd} value={end} onChange={(event) => setEnd(event.target.value)} /></label>
          <p className="muted">The first raw record decides. All later records remain, including those outside this period.</p>
          <button type="submit" disabled={waitingFor !== undefined || !range} aria-describedby={waitingFor}>Keep starts in this period</button>
        </form>
      </Section>
      <Section kind="context" only={only}>
        {population.preparation.mapping.context_columns.length === 0 ? <p className="muted">No context columns were mapped. Add them in Data to filter by context.</p> : <form onSubmit={(event) => {
          event.preventDefault();
          const index = Number(column);
          if (!population.preparation.mapping.context_columns.includes(index)) return setError("Choose a mapped context column. Nothing was applied.");
          const text = values.split(/\r?\n/).filter((value) => value !== "");
          if (new Set(text).size !== text.length) return setError("A context value appears more than once. Remove the duplicate; nothing was applied.");
          const chosen = [...new Set<string | null>([...text, ...suggested, ...(missing ? [null] : [])])];
          if (!chosen.length) return setError("Enter at least one exact value or choose Not recorded. Nothing was applied.");
          const submitted: [string | null, ...(string | null)[]] = [chosen[0], ...chosen.slice(1)];
          submit(anchor === "opening"
            ? { kind: "opening_attribute_in", column_index: index, values: submitted, anchor_policy: openingPolicy, negate: false }
            : { kind: "record_attribute_in", column_index: index, values: submitted, negate: false });
        }}>
          <label>Context column<select value={column} onChange={(event) => { setColumn(event.target.value); setValues(""); setSuggested([]); setExact(""); setMissing(false); }}>
            {population.preparation.mapping.context_columns.map((index) => <option key={index} value={index}>{columns.find((item) => item.column_index === index)?.column_name || `Column ${index}`}</option>)}
          </select></label>
          <label>Where to look<select value={anchor} onChange={(event) => setAnchor(event.target.value as typeof anchor)}><option value="any">Any raw record</option><option value="opening">First raw record</option></select></label>
          {anchor === "any" && <p className="muted">With any raw record, an incident counts for every value any of its records holds, so incidents kept by different values can overlap.</p>}
          {selectedColumn && <fieldset><legend>Suggestions from first records</legend>{selectedColumn.categories.map((category) => {
            const checked = category.value === null ? missing : suggested.includes(category.value);
            return <label className="filter-value" key={category.value === null ? "missing" : `value:${category.value}`}><input type="checkbox" checked={checked} onChange={(event) => {
              if (category.value === null) return setMissing(event.target.checked);
              const value = category.value;
              setSuggested((current) => event.target.checked ? [...new Set([...current, value])] : current.filter((item) => item !== value));
            }} />{category.value === null ? "Not recorded" : JSON.stringify(category.value)} · {category.parent.count} of {category.parent.denominator}</label>;
          })}</fieldset>}
          <label>Exact context values<textarea value={values} onChange={(event) => setValues(event.target.value)} rows={3} spellCheck={false} /></label>
          <p className="muted">One value per line; spaces are significant. Values are joined by OR. Suggestions are not an exhaustive list of values at any record.</p>
          <label>One exact value, including line breaks<textarea value={exact} onChange={(event) => setExact(event.target.value)} rows={2} spellCheck={false} /></label>
          <button type="button" onClick={() => {
            if (exact === "") return setError("Enter an exact value; use Not recorded for missing.");
            setSuggested((current) => [...new Set([...current, exact])]); setExact(""); setError(null);
          }}>Add this exact value</button>
          {suggested.length > 0 && <ul aria-label="Chosen exact values">{suggested.map((value) => <li key={value}><span>{JSON.stringify(value)}</span> <button type="button" onClick={() => setSuggested((current) => current.filter((item) => item !== value))}>Remove exact value {JSON.stringify(value)}</button></li>)}</ul>}
          <label className="filter-value"><input type="checkbox" checked={missing} onChange={(event) => setMissing(event.target.checked)} />Not recorded (distinct from the text “Unknown”)</label>
          <button type="submit" disabled={waitingFor !== undefined} aria-describedby={waitingFor}>Keep by context</button>
        </form>}
      </Section>
    </section>
  );
}

/**
 * One kind of step: among all of them, a disclosure that opens on request; alone, as "+ Add step" shows it, its form
 * under its name; and nothing where another kind is shown alone.
 */
function Section({ kind, only, open, children }: { kind: StepKind; only?: StepKind; open?: boolean; children: ReactNode }) {
  if (only !== undefined && only !== kind) return null;
  if (only === kind) return <div className="add-step-form">{children}</div>;
  return (
    <details open={open}>
      <summary>{STEP_KINDS[kind]}</summary>
      {children}
    </details>
  );
}
