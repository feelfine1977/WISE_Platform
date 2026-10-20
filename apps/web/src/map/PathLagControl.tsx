import { useId, useState } from "react";
import type { SelectionPredicate } from "../generated/selection";
import { lagHours, stepWording } from "./wording";
import { StepPreviewLine, type StepPreviewer } from "./StepPreviewLine";

type Unit = "hours" | "days";
type LagStep = Extract<SelectionPredicate, { kind: "path_lag_in_range" }>;

interface PathLagControlProps {
  source: string;
  target: string;
  /** The median lag of the path's passages as the map supplies it, offered as a bound; null where the path has none. */
  medianLagHours: number | null;
  onStep: (step: SelectionPredicate) => void;
  previewStep?: StepPreviewer;
  waitingFor?: string;
}

/** The bounds typed, in the unit chosen, as a step on the lag of the path, or why they are none. */
export function lagStep(
  source: string,
  target: string,
  entered: { low: string; lowIncluded: boolean; high: string; highIncluded: boolean; unit: Unit; every: boolean },
  negate: boolean,
): LagStep | string {
  const factor = entered.unit === "days" ? 24 : 1;
  const read = (text: string) => (text.trim() === "" ? null : Number(text));
  const low = read(entered.low);
  const high = read(entered.high);
  const valid = (value: number | null) => value === null || (Number.isFinite(value) && value >= 0);
  if (low === null && high === null) return "Enter at least one bound of the lag. Nothing was applied.";
  if (!valid(low) || !valid(high)) return `Enter each bound as a finite number of ${entered.unit}, zero or more. Nothing was applied.`;
  if (low !== null && high !== null && (high < low || (high === low && !(entered.lowIncluded && entered.highIncluded)))) {
    return "The range is empty: the upper bound is below the lower bound, or equal to it and not included. Nothing was applied.";
  }
  return {
    kind: "path_lag_in_range", source_activity: source, target_activity: target,
    minimum_hours: low === null ? null : low * factor, minimum_inclusive: low !== null && entered.lowIncluded,
    maximum_hours: high === null ? null : high * factor, maximum_inclusive: high !== null && entered.highIncluded,
    passages: entered.every ? "every" : "at_least_one", negate,
  };
}

/**
 * On the card of a selected path, of the map or of the list of paths: keep or remove the incidents
 * that pass the path with a lag in a range, the bounds typed or taken from the path's median lag,
 * each included or excluded as stated, for one passage or for every passage. The step is previewed
 * with its counts and taken on request.
 */
export function PathLagControl({ source, target, medianLagHours, onStep, previewStep, waitingFor }: PathLagControlProps) {
  const ids = useId();
  const [unit, setUnit] = useState<Unit>("hours");
  const [low, setLow] = useState("");
  const [lowIncluded, setLowIncluded] = useState(false);
  const [high, setHigh] = useState("");
  const [highIncluded, setHighIncluded] = useState(true);
  const [every, setEvery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<LagStep | null>(null);
  const inUnit = (hours: number) => String(unit === "days" ? hours / 24 : hours);

  const ask = (negate: boolean) => {
    const step = lagStep(source, target, { low, lowIncluded, high, highIncluded, unit, every }, negate);
    if (typeof step === "string") {
      setError(step);
      setPending(null);
      return;
    }
    setError(null);
    if (previewStep) setPending(step);
    else onStep(step);
  };

  return (
    <fieldset className="path-lag">
      <legend>By the lag of this path</legend>
      <p className="muted">
        The lag of a passage is the time from “{source}” to the next labelled record, “{target}”, as the path's lag is measured
        {medianLagHours !== null && medianLagHours !== undefined ? `; the path's median lag is ${lagHours(Number(medianLagHours.toFixed(3)))}` : ""}.
        An incident whose order is not known is not evaluable and is counted apart; one that never passes the path is outside.
      </p>
      {medianLagHours !== null && medianLagHours !== undefined && (
        <p className="path-lag-presets">
          <button type="button" onClick={() => { setLow(inUnit(medianLagHours)); setLowIncluded(false); setHigh(""); setPending(null); }}>
            Slower than the median lag
          </button>{" "}
          <button type="button" onClick={() => { setLow(""); setHigh(inUnit(medianLagHours)); setHighIncluded(true); setPending(null); }}>
            At most the median lag
          </button>
        </p>
      )}
      <label>
        Unit
        <select value={unit} onChange={(event) => { setUnit(event.target.value as Unit); setPending(null); }}>
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
      </label>
      <div className="path-lag-bound">
        <label htmlFor={`${ids}-low`}>Lower bound ({unit}; empty for none)</label>
        <input id={`${ids}-low`} type="number" min="0" step="any" value={low} onChange={(event) => { setLow(event.target.value); setPending(null); }} />
        <label><input type="checkbox" checked={lowIncluded} onChange={(event) => { setLowIncluded(event.target.checked); setPending(null); }} />Lower bound included</label>
      </div>
      <div className="path-lag-bound">
        <label htmlFor={`${ids}-high`}>Upper bound ({unit}; empty for none)</label>
        <input id={`${ids}-high`} type="number" min="0" step="any" value={high} onChange={(event) => { setHigh(event.target.value); setPending(null); }} />
        <label><input type="checkbox" checked={highIncluded} onChange={(event) => { setHighIncluded(event.target.checked); setPending(null); }} />Upper bound included</label>
      </div>
      <label>
        <input type="checkbox" checked={every} onChange={(event) => { setEvery(event.target.checked); setPending(null); }} />
        Every passage of an incident in the range (otherwise one passage is enough)
      </label>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <p>
        <button type="button" disabled={waitingFor !== undefined} aria-describedby={waitingFor} onClick={() => ask(false)}>Keep by this lag</button>{" "}
        <button type="button" disabled={waitingFor !== undefined} aria-describedby={waitingFor} onClick={() => ask(true)}>Remove by this lag</button>
      </p>
      {pending && previewStep && (
        <div className="filter-preview" role="group" aria-label="Lag step not yet taken">
          <p>{stepWording(pending)}</p>
          <StepPreviewLine id={`${ids}-preview`} step={pending} previewer={previewStep} />
          <button type="button" className="primary" disabled={waitingFor !== undefined} aria-describedby={[waitingFor, `${ids}-preview`].filter(Boolean).join(" ")}
            onClick={() => { onStep(pending); setPending(null); }}>
            Take this step
          </button>{" "}
          <button type="button" onClick={() => setPending(null)}>Change the bounds</button>
        </div>
      )}
    </fieldset>
  );
}
