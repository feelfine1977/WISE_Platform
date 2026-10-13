import { useId } from "react";
import type { SelectionPredicate } from "../generated/selection";
import { type ImportedSelectionState, shownSelection } from "../imported/coordinator";
import { ReplacementNotice } from "../replacement/ReplacementNotice";
import type { SelectionProblem } from "./client";
import { canRedo, canUndo } from "./steps";
import { describeSelectionProblem, overlapLine, stepCounts, stepWording } from "./wording";

interface SelectionStepsProps {
  selection: ImportedSelectionState;
  onRemove: (step: SelectionPredicate) => void;
  onClear: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRetry: () => void;
  /** Gives up steps that could not be selected and stays with the selection shown. */
  onStay: () => void;
  /** The id of the text saying why the steps cannot be changed now; while it is given, they wait. */
  waitingFor?: string;
}

/**
 * The steps of the selection as chips. Each chip says what it keeps and shows its own kept,
 * removed and unevaluable incidents over the whole parent, as the local service answered them for
 * the selection shown.
 */
export function SelectionSteps({ selection, onRemove, onClear, onUndo, onRedo, onRetry, onStay, waitingFor }: SelectionStepsProps) {
  const waiting = waitingFor !== undefined;
  const reasonId = useId();
  if (selection.phase === "idle") return null;
  const shown = shownSelection(selection);
  const { history } = selection;
  const results = shown?.answer.predicate_results ?? [];
  return (
    <section className="selection-steps" aria-labelledby="selection-steps-title">
      <div className="selection-head">
        <h3 id="selection-steps-title" className="pane-title">
          Selection of whole incidents
        </h3>
        <div className="selection-actions" role="group" aria-label="Steps">
          <button type="button" onClick={onUndo} disabled={waiting || !canUndo(history)} aria-describedby={waitingFor}>
            Undo
          </button>
          <button type="button" onClick={onRedo} disabled={waiting || !canRedo(history)} aria-describedby={waitingFor}>
            Redo
          </button>
          <button type="button" onClick={onClear} disabled={waiting || history.present.length === 0} aria-describedby={waitingFor}>
            Clear all
          </button>
        </div>
        <p role="status" className="selection-status">
          {selection.phase === "loading" ? "Selecting the incidents and drawing their map…" : ""}
        </p>
      </div>
      {shown && results.length === 0 && (
        <p className="muted">No step yet: every incident of the parent is kept. Select an activity or a path on the map to keep or remove incidents.</p>
      )}
      {results.length > 0 && (
        <ul className="chips" aria-label="Steps of the selection">
          {results.map((result) => {
            const wording = stepWording(result.predicate);
            return (
              <li key={JSON.stringify(result.predicate)} className="chip">
                <p className="chip-wording">{wording}</p>
                <dl className="chip-counts">
                  {stepCounts(result).map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
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
              </li>
            );
          })}
        </ul>
      )}
      {shown && results.length > 1 && <p className="muted overlap-line">{overlapLine(shown.answer.parent)}</p>}
      {selection.phase === "failed" && shown && (
        <ReplacementNotice
          replacement={{ phase: "failed", revision: selection.revision, asked: selection.history, problem: selection.problem }}
          shown="the earlier selection"
          asked="the new selection"
          reasonId={reasonId}
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
