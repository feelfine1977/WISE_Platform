import { useId } from "react";
import type { SelectionPredicate } from "../generated/selection";
import { type ImportedSelectionState, shownSelection } from "../imported/coordinator";
import type { Replacement } from "../replacement/replacement";
import { ReplacementNotice } from "../replacement/ReplacementNotice";
import type { SelectionProblem } from "./client";
import { canRedo, canUndo, type StepHistory } from "./steps";
import { describeSelectionProblem, overlapLine, shortStepWording, stepCounts, stepWording } from "./wording";

interface SelectionStepsProps {
  selection: ImportedSelectionState;
  onRemove: (step: SelectionPredicate) => void;
  onClear: () => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Shows the state after this prefix without discarding its later steps. */
  onChoose: (count: number) => void;
  onRetry: () => void;
  /** Gives up steps that could not be selected and stays with the selection shown. */
  onStay: () => void;
  /** The id of the text saying why the steps cannot be changed now; while it is given, they wait. */
  waitingFor?: string;
}

/**
 * The ordered trail with supplied kept-after-step counts. Details distinguish cumulative prefix
 * support from each predicate’s independent support over the same frozen parent. Future steps
 * remain visible while an earlier answered prefix is selected.
 */
export function SelectionSteps({ selection, onRemove, onClear, onUndo, onRedo, onChoose, onRetry, onStay, waitingFor }: SelectionStepsProps) {
  const waiting = waitingFor !== undefined;
  const reasonId = useId();
  if (selection.phase === "idle") return null;
  const shown = shownSelection(selection);
  const { history } = selection;
  const results = shown?.answer.step_results ?? [];
  const independent = shown?.answer.predicate_results ?? [];
  const active = shown?.answer.active_step_count ?? 0;
  const navigating = waiting || selection.phase !== "ready";
  const replacement = selectionReplacement(selection);
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
      {results.length > 0 && <button type="button" disabled={navigating || active === 0} aria-describedby={waitingFor} onClick={() => onChoose(0)}>Parent · {shown?.answer.parent.case_count.toLocaleString("en")} incidents</button>}
      {results.length > 0 && (
        <ul className="chips" aria-label="Steps of the selection">
          {results.map((result, index) => {
            const wording = stepWording(result.predicate);
            const later = result.step_number > active;
            return (
              <li key={result.step_number} className={later ? "chip chip-later" : "chip"}>
                <button type="button" className="chip-wording" aria-current={active === result.step_number ? "step" : undefined}
                  aria-label={`Show after step ${result.step_number}: ${shortStepWording(result.predicate)}; ${result.kept.case_count.toLocaleString("en")} incidents kept after step ${result.step_number}`}
                  disabled={navigating} aria-describedby={waitingFor} onClick={() => onChoose(result.step_number)}>
                  {shortStepWording(result.predicate)} · {result.kept.case_count.toLocaleString("en")} kept
                </button>
                {later && <span className="muted">Later step</span>}
                {active === result.step_number && <span className="muted">Current step</span>}
                <details>
                  <summary>Details of step {result.step_number}</summary>
                  <p className="chip-full-wording">{wording}</p>
                  <dl className="chip-counts">
                    {stepCounts(result).map(([label, value]) => <div key={label}><dt>{label} after step {result.step_number}</dt><dd>{value}</dd></div>)}
                  </dl>
                  {independent[index] && <>
                    <p>On its own over the whole parent:</p>
                    <dl className="chip-counts chip-independent">{stepCounts(independent[index]).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
                  </>}
                  {!later && <button type="button" className="chip-remove" aria-label={`Remove the step: ${wording}`}
                    disabled={waiting} aria-describedby={waitingFor} onClick={() => onRemove(result.predicate)}>Remove</button>}
                </details>
              </li>
            );
          })}
        </ul>
      )}
      {results.length > 0 && <p className="muted">Counts show what is kept after each ordered step. Saving keeps the active prefix; later steps stay for this session.</p>}
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
