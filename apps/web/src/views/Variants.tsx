import { useRef, useState } from "react";
import { countOf } from "../data/wording";
import type { SelectionPredicate } from "../generated/selection";
import type { ViewState } from "../imported/coordinator";
import { StepPreviewLine, type StepPreviewer } from "../map/StepPreviewLine";
import type { Variant, VariantId, VariantsAnswer } from "./messages";
import { ViewProblemNotice } from "./ViewProblemNotice";
import { percent } from "./wording";

/** Variants listed at first, and how many more each "Show more" adds. */
export const VARIANTS_SHOWN = 25;

interface VariantsProps {
  state: ViewState<VariantsAnswer>;
  chosen: VariantId | null;
  onChoose: (variantId: VariantId) => void;
  onClear: () => void;
  onRetry: () => void;
  /** The id of the text saying why trying again has to wait, while it has to. */
  waitingFor?: string;
  /** Takes the step keeping exactly one variant; with a previewer, the step is previewed first and applied on request. */
  onStep?: (step: SelectionPredicate) => void;
  previewStep?: StepPreviewer;
  /** Shows the incidents with a sequence similar to a variant's; without it no such suggestion is offered. */
  onSimilar?: (variant: Variant, rank: number) => void;
  /** The variant whose similar sequences are shown, by its id. */
  similarTo?: VariantId | null;
}

/** The step keeping the incidents whose complete sequence is exactly this variant's. */
export function variantStep(variant: Variant): SelectionPredicate {
  return { kind: "variant_is", variant: { id: variant.id, activities: [...variant.activities], projection_policy: "incident.activity.omit_missing_retain_raw_gaps.v1" }, negate: false };
}

/** The actual sequences of labelled activities, most incidents first; one can be listed in the table. */
export function Variants({ state, chosen, onChoose, onClear, onRetry, waitingFor, onStep, previewStep, onSimilar, similarTo = null }: VariantsProps) {
  return (
    <section className="view-panel" aria-labelledby="variants-title" aria-busy={state.phase === "loading"}>
      <h3 id="variants-title" className="view-title">
        Variants
      </h3>
      {state.phase === "loading" && <p className="working-text">Reading the sequence of every incident…</p>}
      {state.phase === "failed" && <ViewProblemNotice title="The variants cannot be shown" problem={state.problem} onRetry={onRetry} waitingFor={waitingFor} />}
      {state.phase === "ready" && (
        <VariantList key={state.answer.request_id} answer={state.answer} chosen={chosen} onChoose={onChoose} onClear={onClear}
          actions={onStep ? { onStep, previewStep, waitingFor } : undefined} onSimilar={onSimilar} similarTo={similarTo} />
      )}
    </section>
  );
}

interface StepActions {
  onStep: (step: SelectionPredicate) => void;
  previewStep?: StepPreviewer;
  waitingFor?: string;
}

interface VariantListProps {
  answer: VariantsAnswer;
  chosen: VariantId | null;
  onChoose: (variantId: VariantId) => void;
  onClear: () => void;
  actions?: StepActions;
  onSimilar?: (variant: Variant, rank: number) => void;
  similarTo?: VariantId | null;
}

/** How the ranked variants, the ones not shown and the incidents of unknown order add up to the incidents counted. */
export function inventoryLine(summary: VariantsAnswer["variants"], listed: number): string {
  const inVariants = summary.variants.reduce((total, variant) => total + variant.case_count, 0);
  const notShown = summary.variants.slice(listed).reduce((total, variant) => total + variant.case_count, 0);
  const parts = [`${countOf(inVariants, "incident")} in ${countOf(summary.variant_count, "variant")}`];
  if (listed < summary.variant_count) parts[0] += ` (${countOf(summary.variant_count - listed, "variant")} with ${countOf(notShown, "incident")} not shown yet)`;
  if (summary.unevaluable.case_count > 0) parts.push(`${countOf(summary.unevaluable.case_count, "incident")} with no known order`);
  return `${parts.join(" and ")}: ${countOf(summary.case_count, "incident")} counted exactly, none sampled.`;
}

function VariantList({ answer, chosen, onChoose, onClear, actions, onSimilar, similarTo = null }: VariantListProps) {
  const summary = answer.variants;
  const [shown, setShown] = useState(VARIANTS_SHOWN);
  const [pending, setPending] = useState<VariantId | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const chosenRank = summary.variants.findIndex((variant) => variant.id === chosen);
  const pendingRank = summary.variants.findIndex((variant) => variant.id === pending);
  const listed = summary.variants.slice(0, Math.max(shown, chosenRank + 1, pendingRank + 1));
  const rest = summary.variants.length - listed.length;
  // Back from a preview, applied or cancelled, the focus returns to the button that opened it.
  const settle = (variantId: VariantId) => {
    setPending(null);
    requestAnimationFrame(() =>
      [...(root.current?.querySelectorAll<HTMLElement>("[data-variant-preview]") ?? [])].find((button) => button.dataset.variantPreview === variantId)?.focus(),
    );
  };
  return (
    <div ref={root}>
      <p className="muted view-hint">
        Each variant is one actual sequence of labelled activities in the declared order, repeats included. Shares are of the{" "}
        {countOf(summary.sequence_evaluable_case_count, "incident")} whose order is known, among the incidents opened, whatever steps the selection takes.
      </p>
      <p className="muted view-hint variant-inventory">{inventoryLine(summary, listed.length)}</p>
      {summary.unevaluable.case_count > 0 && (
        <p className="order-note">
          {countOf(summary.unevaluable.case_count, "incident")} {summary.unevaluable.case_count === 1 ? "has" : "have"} no known order and{" "}
          {summary.unevaluable.case_count === 1 ? "is" : "are"} in no variant.
        </p>
      )}
      {summary.omitted_activity_record_count > 0 && (
        <p className="muted view-hint">
          {countOf(summary.omitted_activity_record_count, "record")} without an activity label {summary.omitted_activity_record_count === 1 ? "is" : "are"} left
          out of the sequences.
        </p>
      )}
      {summary.variants.length === 0 ? (
        <p className="working-text">No incident here has a known order, so there is no variant to show.</p>
      ) : (
        <>
          <p className="muted view-hint">
            {listed.length < summary.variant_count
              ? `Showing ${listed.length} of ${countOf(summary.variant_count, "variant")}.`
              : `${countOf(summary.variant_count, "variant")}.`}{" "}
            Listing a variant's incidents in the table is a view: the population and every count stay as they are.
            {actions && " Keeping a variant is a step: it keeps the incidents whose complete sequence is exactly that one."}
          </p>
          {actions && (
            <p className="muted view-hint">Only a whole sequence can be kept here. Partial patterns, wildcards, gaps and “not followed by” are not available.</p>
          )}
          <ol className="variant-list" aria-label="Variants, most incidents first">
            {listed.map((variant, index) => (
              <VariantItem
                key={variant.id}
                variant={variant}
                rank={index + 1}
                chosen={variant.id === chosen}
                onToggle={() => (variant.id === chosen ? onClear() : onChoose(variant.id))}
                actions={actions}
                pending={variant.id === pending}
                onPreview={() => setPending(variant.id)}
                onSettle={() => settle(variant.id)}
                onSimilar={onSimilar && variant.activities.length > 0 ? () => onSimilar(variant, index + 1) : undefined}
                similar={similarTo === variant.id}
              />
            ))}
          </ol>
          {rest > 0 && (
            <button type="button" className="show-more" onClick={() => setShown((count) => count + VARIANTS_SHOWN)}>
              Show {Math.min(rest, VARIANTS_SHOWN)} more of {countOf(rest, "variant")} not shown
            </button>
          )}
        </>
      )}
    </div>
  );
}

interface VariantItemProps {
  variant: Variant;
  rank: number;
  chosen: boolean;
  onToggle: () => void;
  actions?: StepActions;
  pending: boolean;
  onPreview: () => void;
  onSettle: () => void;
  onSimilar?: () => void;
  similar?: boolean;
}

function VariantItem({ variant, rank, chosen, onToggle, actions, pending, onPreview, onSettle, onSimilar, similar = false }: VariantItemProps) {
  const incidents = countOf(variant.case_count, "incident");
  const described = `${variant.case_count} of ${variant.denominator} incidents whose order is known (${percent(variant.share)})`;
  const steps = variant.activities.length;
  return (
    <li className={chosen ? "variant chosen" : "variant"}>
      <div className="variant-head">
        <span className="variant-rank">Variant {rank}</span>
        <span className="variant-figures" title={described}>
          <span aria-hidden="true">
            {incidents} · {percent(variant.share)}
          </span>
          <span className="visually-hidden">{described}</span>
        </span>
        <button type="button" aria-pressed={chosen} aria-label={`List the ${incidents} of variant ${rank} in the table`} onClick={onToggle}>
          {chosen ? "Listed" : "List incidents"}
        </button>
        {actions && (
          <button type="button" data-variant-preview={variant.id} disabled={actions.waitingFor !== undefined || pending} aria-describedby={actions.waitingFor}
            aria-label={actions.previewStep ? `Preview keeping the ${incidents} of variant ${rank}` : `Keep the ${incidents} of variant ${rank}`}
            onClick={() => (actions.previewStep ? onPreview() : actions.onStep(variantStep(variant)))}>
            {actions.previewStep ? "Preview keeping" : "Keep"}
          </button>
        )}
        {onSimilar && (
          <button type="button" aria-pressed={similar} aria-label={`Incidents with a sequence similar to variant ${rank}`} onClick={onSimilar}>
            Similar sequences
          </button>
        )}
      </div>
      {steps === 0 ? (
        <p className="missing-text">No labelled activity: every record of these incidents lacks an activity label.</p>
      ) : (
        <ol className="variant-steps" aria-label={`Sequence of variant ${rank}, ${countOf(steps, "step")}`}>
          {variant.activities.map((activity, index) => (
            <li key={index}>
              {index > 0 && (
                <span className="variant-arrow" aria-hidden="true">
                  →
                </span>
              )}
              <span className="variant-step">{activity}</span>
            </li>
          ))}
        </ol>
      )}
      {actions?.previewStep && pending && (
        <div className="filter-preview" role="group" aria-label={`Variant ${rank} not yet applied`}>
          <StepPreviewLine id={`variant-${rank}-preview`} step={variantStep(variant)} previewer={actions.previewStep} />
          <button type="button" className="primary" disabled={actions.waitingFor !== undefined} aria-describedby={[actions.waitingFor, `variant-${rank}-preview`].filter(Boolean).join(" ")}
            onClick={() => { actions.onStep(variantStep(variant)); onSettle(); }}>
            Apply
          </button>
          <button type="button" onClick={onSettle}>Cancel</button>
        </div>
      )}
    </li>
  );
}
