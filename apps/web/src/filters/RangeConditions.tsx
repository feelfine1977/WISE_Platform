import { useState } from "react";
import type { SelectionPredicate } from "../generated/selection";
import "./filters.css";

type IncidentMeasure = "observed_span_between" | "max_raw_gap_between" | "raw_record_count_between";
interface RangeProps {
  onStep: (step: SelectionPredicate) => void;
  waitingFor?: string;
}

function bounds(lower: string, upper: string, whole: boolean): [number, number | null] | null {
  const from = Number(lower), to = upper.trim() === "" ? null : Number(upper);
  const valid = (value: number) => Number.isFinite(value) && value >= 0 && (!whole || Number.isSafeInteger(value));
  return lower.trim() !== "" && valid(from) && (to === null || (valid(to) && from <= to)) ? [from, to] : null;
}

/** One inclusive range is one analytical step; Undo removes both bounds together. */
export function IncidentRangeFilter({ onStep, waitingFor }: RangeProps) {
  const [measure, setMeasure] = useState<IncidentMeasure>("observed_span_between");
  const [lower, setLower] = useState("");
  const [upper, setUpper] = useState("");
  const [remove, setRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const records = measure === "raw_record_count_between";
  return (
    <form className="range-condition" onSubmit={(event) => {
      event.preventDefault();
      const range = bounds(lower, upper, records);
      if (range === null) return setError(records ? "Enter whole raw-record counts, zero or more, with the lower bound no greater than the upper. Nothing was applied." : "Enter finite hours, zero or more, with the lower bound no greater than the upper. Nothing was applied.");
      const [minimum, maximum] = range;
      setError(null);
      onStep(records
        ? { kind: "raw_record_count_between", minimum_records: minimum, maximum_records: maximum, negate: remove }
        : { kind: measure, minimum_hours: minimum, maximum_hours: maximum, negate: remove });
    }}>
      <label>Range measure<select value={measure} onChange={(event) => { setMeasure(event.target.value as IncidentMeasure); setLower(""); setUpper(""); setError(null); }}>
        <option value="observed_span_between">Recorded span</option>
        <option value="max_raw_gap_between">Longest adjacent raw-record gap</option>
        <option value="raw_record_count_between">Number of raw records</option>
      </select></label>
      <label>Lower bound (included), {records ? "records" : "hours"}<input type="number" min="0" step={records ? "1" : "any"} value={lower} onChange={(event) => setLower(event.target.value)} /></label>
      <label>Upper bound (included), {records ? "records" : "hours"}<input type="number" min="0" step={records ? "1" : "any"} value={upper} onChange={(event) => setUpper(event.target.value)} /></label>
      <p className="muted">Both bounds include equality. A blank upper bound means no upper limit. The range adds one step; Undo takes both bounds back together.</p>
      <p className="muted">Raw records include records without activity labels and do not require known chronology. Time measures require known chronology; one record has a span of zero and no gap. Unavailable measures remain not evaluable, including when removing a range.</p>
      <label>Range action<select value={remove ? "remove" : "keep"} onChange={(event) => setRemove(event.target.value === "remove")}><option value="keep">Keep incidents in this range</option><option value="remove">Remove incidents in this range</option></select></label>
      {error && <p role="alert" className="inline-error">{error}</p>}
      <button type="submit" disabled={waitingFor !== undefined} aria-describedby={waitingFor}>{remove ? "Remove" : "Keep"} by this range</button>
    </form>
  );
}

export interface PathLagRangeFilterProps extends RangeProps {
  sourceActivity: string;
  targetActivity: string;
  timestampKind: "utc_instant" | "wall_clock";
}

/** Mount in the selected path card or path-list row; the service alone evaluates every passage. */
export function PathLagRangeFilter({ sourceActivity, targetActivity, timestampKind, onStep, waitingFor }: PathLagRangeFilterProps) {
  const [lower, setLower] = useState("");
  const [upper, setUpper] = useState("");
  const [quantifier, setQuantifier] = useState<"any" | "every">("any");
  const [remove, setRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="range-condition" aria-label={`Lag range from ${sourceActivity} to ${targetActivity}`} onSubmit={(event) => {
      event.preventDefault();
      const range = bounds(lower, upper, false);
      if (range === null) return setError("Enter finite hours, zero or more, with the lower bound no greater than the upper. Nothing was applied.");
      setError(null);
      onStep({ kind: "directly_follows_lag_between", source_activity: sourceActivity, target_activity: targetActivity, minimum_hours: range[0], maximum_hours: range[1], quantifier, negate: remove });
    }}>
      <p>Passages from “{sourceActivity}” to “{targetActivity}” · {timestampKind === "utc_instant" ? "elapsed UTC hours" : "recorded wall-clock hours"}</p>
      <label>Lower lag bound (included), hours<input type="number" min="0" step="any" value={lower} onChange={(event) => setLower(event.target.value)} /></label>
      <label>Upper lag bound (included), hours<input type="number" min="0" step="any" value={upper} onChange={(event) => setUpper(event.target.value)} /></label>
      <label>Passages required<select value={quantifier} onChange={(event) => setQuantifier(event.target.value as "any" | "every")}><option value="any">At least one passage</option><option value="every">Every passage</option></select></label>
      <p className="muted">Both bounds include equality; leave the upper blank for no upper limit. Both choices require a passage of this mapped pair, including bridges over unlabelled records. Unknown order is not evaluable. Removing reverses known matches only; it keeps known incidents with no passage and leaves unknown order not evaluable.</p>
      {timestampKind === "wall_clock" && <p className="muted">Recorded wall-clock differences may differ from physical elapsed time across clock changes.</p>}
      <label>Path range action<select value={remove ? "remove" : "keep"} onChange={(event) => setRemove(event.target.value === "remove")}><option value="keep">Keep matching incidents</option><option value="remove">Remove matching incidents</option></select></label>
      {error && <p role="alert" className="inline-error">{error}</p>}
      <button type="submit" disabled={waitingFor !== undefined} aria-describedby={waitingFor}>{remove ? "Remove" : "Keep"} by path lag</button>
    </form>
  );
}
