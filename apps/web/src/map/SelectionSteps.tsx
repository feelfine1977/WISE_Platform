import { useEffect, useId, useRef, useState } from "react";
import type { SelectionPredicate } from "../generated/selection";
import { type ImportedSelectionState, shownSelection } from "../imported/coordinator";
import type { Replacement } from "../replacement/replacement";
import { ReplacementNotice } from "../replacement/ReplacementNotice";
import type { SelectionProblem } from "./client";
import { IconButton } from "../components/icons";
import { countOf } from "../data/wording";
import { canRedo, canUndo, type StepHistory, trailOf } from "./steps";
import { COMBINATION, combinedLine, describeSelectionProblem, overlapLine, shortStepWording, stepCounts, stepWording, unevaluableReason } from "./wording";

interface SelectionStepsProps {
  selection: ImportedSelectionState;
  onRemove: (step: SelectionPredicate) => void;
  onClear: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRetry: () => void;
  /** Shows the state after the first `count` steps of the trail; the later steps stay until a new step is taken. */
  onShowAfter?: (count: number) => void;
  /** Where the line of guidance leads: the map, the chart of starts, and "+ Add step". Without it the line names the map only. */
  guide?: { onShowMap: () => void; onShowStarts: () => void; onAddStep: () => void };
  /** Gives up steps that could not be selected and stays with the selection shown. */
  onStay: () => void;
  /** The id of the text saying why the steps cannot be changed now; while it is given, they wait. */
  waitingFor?: string;
}

/**
 * The steps of the selection as a trail of short chips, the earliest first. Each chip says its step in
 * a few words and the incidents kept after it ("kept after step k", as the local service supplies it);
 * its full wording, its own kept, removed and unevaluable incidents over the whole parent and its
 * actions open on demand. The trail leads back to any earlier state, the parent first; the later steps
 * stay in the trail, not applied, until a new step is taken.
 */
export function SelectionSteps({ selection, onRemove, onClear, onUndo, onRedo, onRetry, onShowAfter, onStay, waitingFor, guide }: SelectionStepsProps) {
  const waiting = waitingFor !== undefined;
  const reasonId = useId();
  // The line after the first step gives way for good once the analyst has undone that step or taken another.
  const stepCount = selection.phase === "idle" ? 0 : shownSelection(selection)?.answer.predicate_results.length ?? 0;
  const previousCount = useRef(stepCount);
  const [firstStepGuided, setFirstStepGuided] = useState(false);
  useEffect(() => {
    if (previousCount.current === 1 && stepCount !== 1) setFirstStepGuided(true);
    previousCount.current = stepCount;
  }, [stepCount]);
  // The incidents kept after each step of a trail, by the steps up to it, as answered: a later step not applied now keeps its count.
  const keptAfter = useRef(new Map<string, number>()).current;
  if (selection.phase === "idle") return null;
  const shown = shownSelection(selection);
  const { history } = selection;
  const results = shown?.answer.predicate_results ?? [];
  const replacement = selectionReplacement(selection);
  const parentKey = shown ? JSON.stringify(shown.answer.parent_identity) : "";
  const prefixKey = (steps: readonly unknown[]) => `${parentKey}${JSON.stringify(steps)}`;
  results.forEach((result, index) => {
    if (result.kept_after_step) keptAfter.set(prefixKey(results.slice(0, index + 1).map((item) => item.predicate)), result.kept_after_step.case_count);
  });
  // The later steps of the trail, after the state shown, kept until a new step is taken.
  const trail = trailOf(history);
  const later = shown && history.present.length === results.length ? trail.slice(results.length) : [];
  const keptLine = (count: number | undefined) => (count === undefined ? "kept: not counted now" : `${count.toLocaleString("en")} kept`);
  return (
    <section className="selection-steps" aria-labelledby="selection-steps-title">
      <div className="selection-head">
        <h3 id="selection-steps-title" className="pane-title">
          Steps
        </h3>
        {/* Three fixed slots: an action that cannot be used now stays in its place, disabled, with the reason in its description. */}
        <div className="selection-actions" role="group" aria-label="Steps">
          <IconButton icon="undo" label="Undo" onClick={onUndo} disabled={waiting || !canUndo(history)} describedBy={waitingFor}
            hint={canUndo(history) ? "Takes back the last change of the steps." : "Nothing to undo: the steps have not been changed."} />
          <IconButton icon="redo" label="Redo" onClick={onRedo} disabled={waiting || !canRedo(history)} describedBy={waitingFor}
            hint={canRedo(history) ? "Takes the change that was undone again." : "Nothing to redo: no change of the steps has been undone."} />
          <IconButton icon="clearAll" label="Clear all" onClick={onClear} disabled={waiting || history.present.length === 0} describedBy={waitingFor}
            hint={history.present.length > 0 ? "Removes every step: every incident of the parent is kept again." : "No step to clear: every incident of the parent is kept."} />
        </div>
        <p role="status" className="selection-status">
          {selection.phase === "loading" ? "Selecting the incidents and drawing their map…" : ""}
        </p>
      </div>
      {/* One line of guidance at most: what can be done first, or, after the first step, how to go back or on. */}
      {shown && results.length === 0 && (
        guide ? (
          <p className="muted guide-line">
            No step yet: every incident of the parent is kept. Take a first step:{" "}
            <button type="button" className="link-button" onClick={guide.onShowMap}>select an activity or a path on the map</button>,{" "}
            <button type="button" className="link-button" onClick={guide.onShowStarts}>drag over a period of starts</button>, or{" "}
            <button type="button" className="link-button" onClick={guide.onAddStep}>add a step</button>.
          </p>
        ) : (
          <p className="muted">No step yet: every incident of the parent is kept. Select an activity or a path on the map to keep or remove incidents.</p>
        )
      )}
      {shown && guide && results.length === 1 && !firstStepGuided && (
        <p className="muted guide-line">
          One step taken: Undo takes it back, or <button type="button" className="link-button" onClick={guide.onAddStep}>add another step</button>.
        </p>
      )}
      {shown && (results.length > 0 || later.length > 0) && onShowAfter && (
        <p className="trail-start">
          <button type="button" disabled={waiting || results.length === 0} aria-describedby={waitingFor} onClick={() => onShowAfter(0)}>
            Every incident of the parent · {shown.answer.parent.case_count.toLocaleString("en")}
          </button>
        </p>
      )}
      {results.length > 0 && (
        <ul className="chips" aria-label="Steps of the selection">
          {results.map((result, index) => {
            const wording = stepWording(result.predicate);
            const last = index === results.length - 1;
            return (
              <li key={JSON.stringify(result.predicate)} className="chip" aria-current={last ? "step" : undefined}>
                <details>
                  <summary>
                    <span className="chip-short">{index + 1}. {shortStepWording(result.predicate)}</span>
                    <span className="chip-kept">{keptLine(result.kept_after_step?.case_count)}</span>
                  </summary>
                  <p className="chip-wording">{wording}</p>
                  {result.kept_after_step && (
                    <p className="chip-after">
                      After this step: {countOf(result.kept_after_step.case_count, "incident")} · {countOf(result.kept_after_step.record_count, "record")} kept
                    </p>
                  )}
                  <dl className="chip-counts">
                    {stepCounts(result).map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {result.unevaluable.case_count > 0 && unevaluableReason(result.predicate) !== null && (
                    <p className="chip-reason">Not evaluable because {unevaluableReason(result.predicate)}.</p>
                  )}
                  <p className="chip-actions">
                    {!last && onShowAfter && (
                      <button type="button" disabled={waiting} aria-describedby={waitingFor} onClick={() => onShowAfter(index + 1)}>
                        Show the selection after this step
                      </button>
                    )}{" "}
                    <button
                      type="button"
                      className="chip-remove"
                      aria-label={`Remove the step: ${wording}`}
                      disabled={waiting}
                      aria-describedby={waitingFor}
                      onClick={() => onRemove(result.predicate)}
                    >
                      Remove
                    </button>
                  </p>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      {later.length > 0 && onShowAfter && (
        <ul className="chips chips-later" aria-label="Later steps, not applied now">
          {later.map((step, offset) => {
            const count = results.length + offset + 1;
            return (
              <li key={JSON.stringify(step)} className="chip chip-later">
                <details>
                  <summary>
                    <span className="chip-short">{count}. {shortStepWording(step)}</span>
                    <span className="chip-kept">{keptLine(keptAfter.get(prefixKey(trail.slice(0, count))))}</span>
                  </summary>
                  <p className="chip-wording">{stepWording(step)}</p>
                  <p className="muted">Not applied now; it stays in the trail until a new step is taken.</p>
                  <button type="button" disabled={waiting} aria-describedby={waitingFor} onClick={() => onShowAfter(count)}>
                    Show the selection after this step
                  </button>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      {shown && results.length > 0 && (
        <p className="combined-line">{combinedLine(shown.answer.parent, shown.answer.kept, shown.answer.removed, shown.answer.unevaluable)}</p>
      )}
      {shown && results.length > 0 && <p className="muted combination-line">{COMBINATION}</p>}
      {shown && results.length > 1 && <p className="muted overlap-line">{overlapLine(shown.answer.parent)}</p>}
      {replacement && (
        <ReplacementNotice
          replacement={replacement}
          shown="the earlier selection"
          asked="the new selection"
          reasonId={reasonId}
          waitingFor={waitingFor}
          describe={describeStepsProblem}
          onRetry={onRetry}
          onStay={onStay}
        />
      )}
      {selection.phase === "failed" && !shown && (
        <SelectionProblemNotice title="The incidents could not be selected" problem={selection.problem} onRetry={waiting ? undefined : onRetry} />
      )}
    </section>
  );
}

/** New steps asked for while an earlier selection is shown: they replace it once they are answered. */
function selectionReplacement(selection: ImportedSelectionState): Replacement<StepHistory, SelectionProblem> | null {
  if (selection.phase === "idle" || selection.phase === "ready" || selection.shown === null) return null;
  return selection.phase === "loading"
    ? { phase: "running", revision: selection.revision, asked: selection.history }
    : { phase: "failed", revision: selection.revision, asked: selection.history, problem: selection.problem };
}

function describeStepsProblem(problem: SelectionProblem) {
  return { ...describeSelectionProblem(problem), retryable: problem.kind !== "refusal" || problem.refusal.retryable };
}

function SelectionProblemNotice({ title, problem, onRetry }: { title: string; problem: Parameters<typeof describeSelectionProblem>[0]; onRetry?: () => void }) {
  const text = describeSelectionProblem(problem);
  const retryable = problem.kind !== "refusal" || problem.refusal.retryable;
  return (
    <div className="inline-error" role="alert">
      <p className="inline-error-title">{title}</p>
      <p>{text.message}</p>
      <p>
        <span className="label-text">What to do</span> {text.remedy}
      </p>
      {retryable && onRetry && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
