import { type FocusEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
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
  const keyboard = useStepsKeyboard(selection);
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
        <div className="selection-actions" role="group" aria-label="Steps" ref={keyboard.bar} onKeyDown={keyboard.onBarKey} onFocus={keyboard.onBarFocus}
          tabIndex={waiting || (!canUndo(history) && !canRedo(history) && history.present.length === 0) ? 0 : undefined}>
          <IconButton icon="undo" label="Undo" onClick={keyboard.acting("undo", onUndo)} disabled={waiting || !canUndo(history)} describedBy={waitingFor}
            hint={canUndo(history) ? "Takes back the last change of the steps." : "Nothing to undo: the steps have not been changed."} />
          <IconButton icon="redo" label="Redo" onClick={keyboard.acting("redo", onRedo)} disabled={waiting || !canRedo(history)} describedBy={waitingFor}
            hint={canRedo(history) ? "Takes the change that was undone again." : "Nothing to redo: no change of the steps has been undone."} />
          <IconButton icon="clearAll" label="Clear all" onClick={keyboard.acting("clear", onClear)} disabled={waiting || history.present.length === 0} describedBy={waitingFor}
            hint={history.present.length > 0 ? "Removes every step: every incident of the parent is kept again." : "No step to clear: every incident of the parent is kept."} />
        </div>
        <p role="status" className="selection-status">
          {selection.phase === "loading" ? "Selecting the incidents and drawing their map…" : ""}
        </p>
        {/* What changed and how many incidents are kept, said politely once the selection is answered. */}
        <p className="visually-hidden steps-announcement" aria-live="polite" aria-atomic="true">{keyboard.announcement}</p>
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
      <div className="trail" role="group" aria-label="Trail of steps" ref={keyboard.trail} onKeyDown={keyboard.onTrailKey} onFocus={keyboard.onTrailFocus}>
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
      </div>
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

type BarAction = "undo" | "redo" | "clear";

/** The pressed button of the views, where Escape leaves the bar of steps and its trail for. */
function leave() {
  document.querySelector<HTMLElement>('[aria-label="View"] button[aria-pressed="true"]')?.focus();
}

/** Moves the focus among some elements by the arrow keys, Home and End; true when the key was one of them. */
function rove(event: KeyboardEvent, items: HTMLElement[], current: number): number | null {
  if (items.length === 0) return null;
  const at = Math.max(0, current);
  const next = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[event.key];
  if (next === undefined) return null;
  event.preventDefault();
  const index = Math.min(items.length - 1, Math.max(0, next));
  items[index].focus();
  return index;
}

/**
 * The keyboard of the bar of steps and of its trail, and what is said when the steps change. Each is one tab stop: the
 * arrow keys, Home and End move within it and Escape leaves it for the views. After Undo, Redo or Clear all the focus stays
 * on the action, or moves to one that can still be used; after a new step it moves to the new chip; it is never lost to
 * the page. Each change is announced politely with the incidents kept.
 */
function useStepsKeyboard(selection: ImportedSelectionState) {
  const bar = useRef<HTMLDivElement>(null);
  const trail = useRef<HTMLDivElement>(null);
  const action = useRef<BarAction | null>(null);
  const trailAt = useRef(-1);
  const [announcement, setAnnouncement] = useState("");
  const shown = shownSelection(selection);
  const answered = selection.phase === "ready" ? shown : null;
  const previous = useRef<{ key: string; steps: string[] } | null>(null);

  const barButtons = () => Array.from(bar.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
  const trailItems = () => Array.from(trail.current?.querySelectorAll<HTMLElement>(".trail-start button, li > details > summary") ?? []);

  // One tab stop in the bar: the button that last had the focus, else the first that can be used.
  useEffect(() => {
    const buttons = barButtons();
    const usable = buttons.filter((button) => !button.disabled);
    const keep = usable.find((button) => button === document.activeElement) ?? usable[0];
    for (const button of buttons) button.tabIndex = button === keep ? 0 : -1;
    // One tab stop in the trail: the item last focused, else the chip of the state shown.
    const items = trailItems();
    const applied = trail.current?.querySelectorAll<HTMLElement>('ul[aria-label="Steps of the selection"] > li > details > summary') ?? [];
    const stop = items[trailAt.current] ?? applied[applied.length - 1] ?? items[0];
    for (const item of items) item.tabIndex = item === stop ? 0 : -1;
  });

  // After an action of the bar the focus stays on it, or goes to one that can still be used, or to the trail: never to the page.
  useEffect(() => {
    if (action.current === null) return;
    const active = document.activeElement as HTMLButtonElement | null;
    if (!active || active === document.body || active.disabled) {
      const usable = barButtons().find((button) => !button.disabled);
      (usable ?? trailItems().at(-1) ?? bar.current)?.focus();
    }
  });

  // What changed, said once the selection is answered; a new step takes the focus to its chip.
  useEffect(() => {
    if (answered === null) return;
    const key = JSON.stringify(answered.answer.identity);
    const steps = answered.answer.predicate_results.map((result) => JSON.stringify(result.predicate));
    const before = previous.current;
    previous.current = { key, steps };
    const done = action.current;
    action.current = null;
    if (before === null || before.key === key) return;
    const results = answered.answer.predicate_results;
    const shortOf = (step: string) => shortStepWording(JSON.parse(step));
    const added = steps.filter((step) => !before.steps.includes(step));
    const removed = before.steps.filter((step) => !steps.includes(step));
    const what =
      done === "clear" ? "Every step removed."
        : added.length === 1 && removed.length === 0 ? `${done === "redo" ? "Redone" : "Step added"}: ${shortOf(added[0])}.`
          : removed.length === 1 && added.length === 0 ? `${done === "undo" ? "Undone" : "Step removed"}: ${shortOf(removed[0])}.`
            : steps.length === 0 ? "Every step removed."
              : `Steps changed: ${steps.length === 1 ? "one step" : `${steps.length} steps`}.`;
    const parent = answered.answer.parent.case_count;
    setAnnouncement(`${what} ${answered.answer.kept.case_count.toLocaleString("en")} of ${parent.toLocaleString("en")} ${parent === 1 ? "incident" : "incidents"} kept.`);
    // A new step takes the focus to its chip where the focus would otherwise be lost: on the page, on "+ Add step" whose panel
    // has closed, or in the bar itself; the focus is left where the analyst is reading anything else.
    const active = document.activeElement;
    const adrift = !active || active === document.body || active.classList.contains("add-step-entry") || !!bar.current?.contains(active) || !!trail.current?.contains(active);
    if (done === null && added.length === 1 && removed.length === 0 && results.length > 0 && adrift) {
      trailAt.current = -1;
      const chips = trail.current?.querySelectorAll<HTMLElement>('ul[aria-label="Steps of the selection"] > li > details > summary');
      chips?.[chips.length - 1]?.focus();
    }
  }, [answered]);

  return {
    bar,
    trail,
    announcement,
    acting: (kind: BarAction, act: () => void) => () => {
      action.current = kind;
      act();
    },
    onBarKey: (event: KeyboardEvent) => {
      if (event.key === "Escape") return leave();
      const usable = barButtons().filter((button) => !button.disabled);
      rove(event, usable, usable.indexOf(document.activeElement as HTMLButtonElement));
    },
    onBarFocus: (event: FocusEvent) => {
      if (event.target === bar.current) barButtons().find((button) => !button.disabled)?.focus();
    },
    onTrailKey: (event: KeyboardEvent) => {
      const items = trailItems();
      const current = items.indexOf(event.target as HTMLElement);
      if (current < 0) return;
      if (event.key === "Escape") return leave();
      const moved = rove(event, items, current);
      if (moved !== null) trailAt.current = moved;
    },
    onTrailFocus: (event: FocusEvent) => {
      const index = trailItems().indexOf(event.target as HTMLElement);
      if (index >= 0) trailAt.current = index;
    },
  };
}
