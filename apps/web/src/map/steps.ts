import { sameJson } from "../data/coordinator";
import type { SelectionPredicate } from "../generated/selection";

/** The steps of a selection in the order the analyst took them; the incidents kept satisfy every one. */
export type Steps = readonly SelectionPredicate[];

/**
 * The steps asked for now, with the earlier and the undone ones. Every change, an undo and a redo
 * give a new history; nothing here counts incidents, which only the local service does.
 */
export interface StepHistory {
  readonly past: readonly Steps[];
  readonly present: Steps;
  readonly future: readonly Steps[];
}

export const noSteps: StepHistory = { past: [], present: [], future: [] };

function changedTo(history: StepHistory, present: Steps): StepHistory {
  return { past: [...history.past, history.present], present, future: [] };
}

/** Adds a step; a step that is already taken is not taken twice. */
export function withStep(history: StepHistory, step: SelectionPredicate): StepHistory {
  if (history.present.some((taken) => sameJson(taken, step))) return history;
  return changedTo(history, [...history.present, step]);
}

/** Removes a step from the present steps. */
export function withoutStep(history: StepHistory, step: SelectionPredicate): StepHistory {
  if (!history.present.some((taken) => sameJson(taken, step))) return history;
  return changedTo(history, history.present.filter((taken) => !sameJson(taken, step)));
}

/** Removes every step, so that every incident of the parent is kept again. */
export function withoutSteps(history: StepHistory): StepHistory {
  return history.present.length === 0 ? history : changedTo(history, []);
}

export function canUndo(history: StepHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: StepHistory): boolean {
  return history.future.length > 0;
}

export function undone(history: StepHistory): StepHistory {
  if (!canUndo(history)) return history;
  return { past: history.past.slice(0, -1), present: history.past[history.past.length - 1], future: [history.present, ...history.future] };
}

export function redone(history: StepHistory): StepHistory {
  if (!canRedo(history)) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}

/**
 * The steps of the trail: the steps asked for now, and after them the later steps an earlier state of the trail was
 * chosen from, which are kept until a new step is taken.
 */
export function trailOf(history: StepHistory): Steps {
  const next = history.future[0];
  const extends_ = next !== undefined && next.length > history.present.length && history.present.every((step, index) => sameJson(step, next[index]));
  return extends_ ? next : history.present;
}

/**
 * The state after the first `count` steps of the trail, the later steps kept as the next to redo until a new step is
 * taken; choosing a later step goes forward along the same trail.
 */
export function backTo(history: StepHistory, count: number): StepHistory {
  const trail = trailOf(history);
  if (count === history.present.length || count < 0 || count > trail.length) return history;
  const ahead = trail === history.present ? [history.present, ...history.future] : history.future;
  if (count === trail.length) return { past: history.past, present: trail, future: ahead.slice(1) };
  return { past: history.past, present: trail.slice(0, count), future: ahead };
}
