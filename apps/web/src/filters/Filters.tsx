import { useId, useState } from "react";
import type { ImportedPopulationAnswer } from "../generated/imports";
import type { SelectionPredicate } from "../generated/selection";
import type { OpeningContextAnswer } from "../views/messages";
import type { ViewState } from "../imported/coordinator";
import { IncidentRangeFilter } from "./RangeConditions";
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
  range?: RecordedRange | null;
  rangeProblem?: string;
  waitingFor?: string;
}

const openingPolicy = "incident.context.first_record_in_declared_order.v1";

/** Typed filters keep complete incidents; only the local service evaluates membership. */
export function Filters({ population, parentIds, opening, onStep, range, rangeProblem, waitingFor }: FiltersProps) {
  const title = useId();
  const [ids, setIds] = useState("");
  const [measure, setMeasure] = useState<"observed_span_at_least" | "max_raw_gap_at_least">("observed_span_at_least");
  const [hours, setHours] = useState("");
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
  const submit = (step: SelectionPredicate) => { setError(null); onStep(step); };

  return (
    <section className="incident-filters" aria-labelledby={title}>
      <h3 id={title} className="view-title">Filter whole incidents</h3>
      <p className="muted">Each filter adds a step inside the same parent. Every record of a kept incident remains available. Undo removes the last step.</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <details open>
        <summary>Incident numbers</summary>
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
      </details>
      <details>
        <summary>Recorded time</summary>
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
      </details>
      <details>
        <summary>A range of span, longest gap or raw records</summary>
        <IncidentRangeFilter onStep={onStep} waitingFor={waitingFor} />
      </details>
      <details>
        <summary>First record in a period</summary>
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
      </details>
      <details>
        <summary>Context values</summary>
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
      </details>
    </section>
  );
}
