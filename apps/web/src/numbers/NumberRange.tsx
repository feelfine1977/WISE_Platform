import { type ReactNode, useEffect, useId, useState } from "react";
import { countOf } from "../data/wording";
import type { ImportedPopulationAnswer } from "../generated/imports";
import type { NumericContextAnswer, NumericContextRequest } from "../generated/numeric-context";
import type { AnswerIdentity, SelectionPredicate } from "../generated/selection";
import { StepPreviewLine, type StepPreviewer } from "../map/StepPreviewLine";
import { NUMBER_PROJECTIONS, stepWording } from "../map/wording";
import { ColumnChart } from "../time/ColumnChart";
import { httpNumbersClient, type NumbersClient } from "./client";

/** How many bins the parent's range is cut into. */
export const NUMBER_BINS = 10;

type Projection = keyof typeof NUMBER_PROJECTIONS;
type NumberStep = Extract<SelectionPredicate, { kind: "context_number_in_range" }>;
type Read = { phase: "loading" } | { phase: "ready"; answer: NumericContextAnswer } | { phase: "failed"; message: string };

interface NumberRangeProps {
  population: ImportedPopulationAnswer;
  /** The kept incidents: their numbers are counted in the bins the parent fixes. */
  identity: AnswerIdentity;
  revision: number;
  /** The name of a context column, by its place in the source. */
  columnName: (index: number) => string;
  onStep: (step: SelectionPredicate) => void;
  previewStep?: StepPreviewer;
  waitingFor?: string;
  client?: NumbersClient;
  /** Shown alone, as "+ Add step" shows one kind of step: its form, open, without a disclosure. */
  alone?: boolean;
}

/** A number as a bound or a bin edge is written: at most four significant digits, the exact value kept in the step. */
export function numberText(value: number): string {
  return Number(value.toPrecision(4)).toLocaleString("en", { maximumFractionDigits: 6, useGrouping: false });
}

/** The bounds typed, a point or a comma as the decimal separator, as a half-open step, or why they are none. */
export function numberStep(column: number, projection: Projection, low: string, high: string, negate: boolean): NumberStep | string {
  const read = (text: string) => (text.trim() === "" ? null : /^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/.test(text.trim()) ? Number(text.trim().replace(",", ".")) : Number.NaN);
  const minimum = read(low);
  const maximum = read(high);
  if (Number.isNaN(minimum ?? 0) || Number.isNaN(maximum ?? 0)) return "Enter each bound as a number, with a decimal point or comma. Nothing was applied.";
  if (minimum === null && maximum === null) return "Enter at least one bound. Nothing was applied.";
  if (minimum !== null && maximum !== null && maximum <= minimum) return "The upper bound must be above the lower bound: the lower one is included, the upper one is not. Nothing was applied.";
  return { kind: "context_number_in_range", column_index: column, projection, minimum, maximum, negate };
}

/**
 * Keep or remove incidents by a range of the numbers of a context column the analyst declared numeric at import: the
 * column's range in the parent and its distribution on bins the parent fixes, the parent pale and the kept incidents
 * solid, as in the time column; the projection (first record, latest record with a value, any record); and the bounds,
 * typed or chosen on the chart, the lower one included and the upper one excluded. Incidents without the number, and
 * cells that are not numbers, are counted and never read as zero.
 */
export function NumberRange({ population, identity, revision, columnName, onStep, previewStep, waitingFor, client = httpNumbersClient, alone = false }: NumberRangeProps) {
  // Called, never rendered as a component of its own: a component made anew on each render would lose what is typed.
  const frame = (children: ReactNode) =>
    alone ? <div className="number-range add-step-form">{children}</div> : (
      <details className="number-range">
        <summary>A range of a number in a context column</summary>
        {children}
      </details>
    );
  const asked = useId();
  const declared = population.preparation.mapping.numeric_context_columns ?? [];
  const [column, setColumn] = useState<number | null>(declared[0]?.column_index ?? null);
  const [projection, setProjection] = useState<Projection>("first_record");
  const [low, setLow] = useState("");
  const [high, setHigh] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<NumberStep | null>(null);
  const [read, setRead] = useState<Read>({ phase: "loading" });
  const identityKey = JSON.stringify(identity);

  useEffect(() => {
    if (column === null) return;
    const controller = new AbortController();
    const request: NumericContextRequest = {
      schema_version: 1, message_type: "numeric_context_request", request_id: `numbers-${asked}-${revision}-${column}-${projection}`, query_revision: revision,
      workspace_id: population.workspace_id, identity, column_index: column, projection, bin_count: NUMBER_BINS,
    };
    setRead({ phase: "loading" });
    client.numbers(request, controller.signal).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        setRead(outcome.ok ? { phase: "ready", answer: outcome.answer }
          : { phase: "failed", message: outcome.problem.kind === "refusal" ? outcome.problem.refusal.message : "The numbers could not be read from the local service." });
      },
      () => !controller.signal.aborted && setRead({ phase: "failed", message: "The numbers could not be read from the local service." }),
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, population.workspace_id, revision, identityKey, column, projection, asked]);

  if (column === null) {
    return (
      frame(<p className="muted">No context column was declared a number. Declare one in Data, with its unit, to keep incidents by a range of its numbers.</p>)
    );
  }
  const unit = declared.find((item) => item.column_index === column)?.unit ?? null;
  const withUnit = (value: number) => `${numberText(value)}${unit ? ` ${unit}` : ""}`;
  const propose = (step: NumberStep | string) => {
    if (typeof step === "string") {
      setError(step);
      return;
    }
    setError(null);
    if (previewStep) setPending(step);
    else onStep(step);
  };
  const answer = read.phase === "ready" ? read.answer : null;
  const bins = answer?.bins.map((bin) => ({
    label: bin.end_exclusive === null ? `${numberText(bin.start_inclusive)} or more` : `${numberText(bin.start_inclusive)} to under ${numberText(bin.end_exclusive)}`,
    parent: bin.parent_case_count,
    kept: bin.kept_case_count,
  })) ?? [];
  const missing = (side: NumericContextAnswer["parent"]) => side.unavailable.filter((item) => item.case_count > 0);
  const reasons = { order_unknown: "order not known", missing: "no value", not_a_number: "not a number" } as const;

  return frame(
    <>
      <label>
        Column
        <select value={String(column)} onChange={(event) => { setColumn(Number(event.target.value)); setPending(null); setLow(""); setHigh(""); }}>
          {declared.map((item) => (
            <option key={item.column_index} value={String(item.column_index)}>
              {columnName(item.column_index)}{item.unit ? ` (${item.unit})` : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        Read at
        <select value={projection} onChange={(event) => { setProjection(event.target.value as Projection); setPending(null); }}>
          {(Object.keys(NUMBER_PROJECTIONS) as Projection[]).map((key) => <option key={key} value={key}>{NUMBER_PROJECTIONS[key]}</option>)}
        </select>
      </label>
      {read.phase === "loading" && <p className="working-text">Reading the numbers…</p>}
      {read.phase === "failed" && <p className="inline-error" role="alert">{read.message}</p>}
      {answer && (
        <div className="number-range-read">
          <p className="muted">
            {answer.parent_range === null
              ? "No incident of the parent has a number here."
              : `Range in the parent: ${withUnit(answer.parent_range.minimum)} to ${withUnit(answer.parent_range.maximum)}; ${countOf(answer.kept.measured_case_count, "kept incident")} of ${answer.kept.case_count.toLocaleString("en")} have a number.`}
          </p>
          {bins.length > 0 && (
            <ColumnChart
              name={`Incidents by ${columnName(column)} at ${NUMBER_PROJECTIONS[projection]}`}
              bins={bins}
              band
              applicable={() => true}
              chosenName={(from, to) => `${bins[from].label.split(" to ")[0]} up to ${answer.bins[to].end_exclusive === null ? "the maximum" : `under ${numberText(answer.bins[to].end_exclusive as number)}`}`}
              stepName={(from, to) => stepWording({ kind: "context_number_in_range", column_index: column, projection, minimum: answer.bins[from].start_inclusive,
                maximum: answer.bins[to].end_exclusive, negate: false })}
              onApply={(from, to) => {
                const minimum = answer.bins[from].start_inclusive;
                const maximum = answer.bins[to].end_exclusive;
                setLow(String(minimum));
                setHigh(maximum === null ? "" : String(maximum));
                propose({ kind: "context_number_in_range", column_index: column, projection, minimum, maximum, negate: false });
              }}
              waitingFor={waitingFor}
              ticks={[bins[0].label, bins[bins.length - 1].label]}
            />
          )}
          {answer.membership_overlaps && <p className="muted">At any record an incident counts in every bin one of its numbers falls into, so the bins overlap.</p>}
          {missing(answer.kept).length > 0 && (
            <p className="limitation">
              Without a number here: {missing(answer.kept).map((item) => `${countOf(item.case_count, "kept incident")} (${reasons[item.reason]})`).join(", ")}; they are not
              evaluable for this step and are counted apart.
            </p>
          )}
          {answer.parent.records.not_a_number_record_count > 0 && (
            <p className="limitation">
              {countOf(answer.parent.records.not_a_number_record_count, "record")} of the parent {answer.parent.records.not_a_number_record_count === 1 ? "holds" : "hold"} text
              that is not a number in this column; it stays as written and is never read as zero.
            </p>
          )}
        </div>
      )}
      <label>
        From, included{unit ? ` (${unit})` : ""}
        <input type="text" inputMode="decimal" value={low} onChange={(event) => { setLow(event.target.value); setPending(null); }} />
      </label>
      <label>
        Up to, not included{unit ? ` (${unit})` : ""}; empty for no upper bound
        <input type="text" inputMode="decimal" value={high} onChange={(event) => { setHigh(event.target.value); setPending(null); }} />
      </label>
      <p className="muted">The lower bound is included and the upper bound is not: an incident exactly at the upper bound is outside the range.</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <p>
        <button type="button" disabled={waitingFor !== undefined} aria-describedby={waitingFor} onClick={() => propose(numberStep(column, projection, low, high, false))}>
          Keep this range of numbers
        </button>{" "}
        <button type="button" disabled={waitingFor !== undefined} aria-describedby={waitingFor} onClick={() => propose(numberStep(column, projection, low, high, true))}>
          Remove this range of numbers
        </button>
      </p>
      {pending && previewStep && (
        <div className="filter-preview" role="group" aria-label="Number step not yet taken">
          <p>{stepWording(pending)}</p>
          <StepPreviewLine id={`${asked}-preview`} step={pending} previewer={previewStep} />
          <button type="button" className="primary" disabled={waitingFor !== undefined} aria-describedby={[waitingFor, `${asked}-preview`].filter(Boolean).join(" ")}
            onClick={() => { onStep(pending); setPending(null); }}>
            Take this step
          </button>{" "}
          <button type="button" onClick={() => setPending(null)}>Change the range</button>
        </div>
      )}
    </>,
  );
}
