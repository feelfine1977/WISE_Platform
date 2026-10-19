import { useEffect, useState } from "react";
import type { SelectionPredicate } from "../generated/selection";
import type { StepPreview } from "../imported/coordinator";
import { countOf } from "../data/wording";
import { describeSelectionProblem } from "./wording";

/** Counts what one more step would keep, without taking it. */
export type StepPreviewer = (step: SelectionPredicate, signal: AbortSignal) => Promise<StepPreview>;

/**
 * What a step would do before it is taken: the incidents it would keep, remove and leave not evaluable, counted by the
 * local service from the selection shown. Only taking the step changes the selection; this line changes nothing.
 */
export function StepPreviewLine({ id, step, previewer }: { id: string; step: SelectionPredicate; previewer: StepPreviewer }) {
  const [preview, setPreview] = useState<StepPreview | null>(null);
  const key = JSON.stringify(step);
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null);
    previewer(step, controller.signal).then((outcome) => {
      if (!controller.signal.aborted) setPreview(outcome);
    });
    return () => controller.abort();
    // The step is compared by its content; a new previewer stands for a new selection shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, previewer]);
  if (preview === null) return <p id={id} className="muted step-preview">Counting what this step would keep…</p>;
  if (!preview.ok) return <p id={id} className="muted step-preview">What this step would keep cannot be counted: {describeSelectionProblem(preview.problem).message}</p>;
  return (
    <p id={id} className="muted step-preview">
      Preview: would keep {countOf(preview.kept, "incident")} of {countOf(preview.parent, "incident")}; {preview.removed.toLocaleString("en")} removed,{" "}
      {preview.unevaluable.toLocaleString("en")} not evaluable. Nothing changes until the step is taken.
    </p>
  );
}
