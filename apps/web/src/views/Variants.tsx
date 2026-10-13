import { useState } from "react";
import { countOf } from "../data/wording";
import type { ViewState } from "../imported/coordinator";
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
}

/** The actual sequences of labelled activities, most incidents first; one can be listed in the table. */
export function Variants({ state, chosen, onChoose, onClear, onRetry }: VariantsProps) {
  return (
    <section className="view-panel" aria-labelledby="variants-title" aria-busy={state.phase === "loading"}>
      <h3 id="variants-title" className="view-title">
        Variants
      </h3>
      {state.phase === "loading" && <p className="working-text">Reading the sequence of every incident…</p>}
      {state.phase === "failed" && <ViewProblemNotice title="The variants cannot be shown" problem={state.problem} onRetry={onRetry} />}
      {state.phase === "ready" && <VariantList key={state.answer.request_id} answer={state.answer} chosen={chosen} onChoose={onChoose} onClear={onClear} />}
    </section>
  );
}

interface VariantListProps {
  answer: VariantsAnswer;
  chosen: VariantId | null;
  onChoose: (variantId: VariantId) => void;
  onClear: () => void;
}

function VariantList({ answer, chosen, onChoose, onClear }: VariantListProps) {
  const summary = answer.variants;
  const [shown, setShown] = useState(VARIANTS_SHOWN);
  const chosenRank = summary.variants.findIndex((variant) => variant.id === chosen);
  const listed = summary.variants.slice(0, Math.max(shown, chosenRank + 1));
  const rest = summary.variants.length - listed.length;
  return (
    <>
      <p className="muted view-hint">
        Each variant is one actual sequence of labelled activities in the declared order, repeats included. Shares are of the{" "}
        {countOf(summary.sequence_evaluable_case_count, "incident")} whose order is known.
      </p>
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
          </p>
          <ol className="variant-list" aria-label="Variants, most incidents first">
            {listed.map((variant, index) => (
              <VariantItem
                key={variant.id}
                variant={variant}
                rank={index + 1}
                chosen={variant.id === chosen}
                onToggle={() => (variant.id === chosen ? onClear() : onChoose(variant.id))}
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
    </>
  );
}

interface VariantItemProps {
  variant: Variant;
  rank: number;
  chosen: boolean;
  onToggle: () => void;
}

function VariantItem({ variant, rank, chosen, onToggle }: VariantItemProps) {
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
    </li>
  );
}
