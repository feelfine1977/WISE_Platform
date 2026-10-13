import type { SelectionPredicate } from "../generated/selection";
import { type ImportedSelectionState, shownSelection } from "../imported/coordinator";
import { canRedo, canUndo } from "./steps";
import { describeSelectionProblem, overlapLine, stepCounts, stepWording } from "./wording";

interface SelectionStepsProps {
  selection: ImportedSelectionState;
  onRemove: (step: SelectionPredicate) => void;
  onClear: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRetry: () => void;
}

/**
 * The steps of the selection as chips. Each chip says what it keeps and shows its own kept,
 * removed and unevaluable incidents over the whole parent, as the local service answered them for
 * the selection shown.
 */
export function SelectionSteps({ selection, onRemove, onClear, onUndo, onRedo, onRetry }: SelectionStepsProps) {
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
          <button type="button" onClick={onUndo} disabled={!canUndo(history)}>
            Undo
          </button>
          <button type="button" onClick={onRedo} disabled={!canRedo(history)}>
            Redo
          </button>
          <button type="button" onClick={onClear} disabled={history.present.length === 0}>
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
                <button type="button" className="chip-remove" aria-label={`Remove the step: ${wording}`} onClick={() => onRemove(result.predicate)}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {shown && results.length > 1 && <p className="muted overlap-line">{overlapLine(shown.answer.parent)}</p>}
      {selection.phase === "failed" && (
        <SelectionProblemNotice
          title={shown ? "This selection could not be made; the previous one is still shown" : "The incidents could not be selected"}
          problem={selection.problem}
          onRetry={onRetry}
        />
      )}
    </section>
  );
}

function SelectionProblemNotice({ title, problem, onRetry }: { title: string; problem: Parameters<typeof describeSelectionProblem>[0]; onRetry: () => void }) {
  const text = describeSelectionProblem(problem);
  const retryable = problem.kind !== "refusal" || problem.refusal.retryable;
  return (
    <div className="inline-error" role="alert">
      <p className="inline-error-title">{title}</p>
      <p>{text.message}</p>
      <p>
        <span className="label-text">What to do</span> {text.remedy}
      </p>
      {retryable && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
