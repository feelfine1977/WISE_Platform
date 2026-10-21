import { useSyncExternalStore } from "react";
import type { RequestsPresentation } from "../generated/saving";
import type { RequestDefinition } from "../generated/unanswered-requests";

/** The analyst's definition of requests and answers for a log, and whether it was reviewed. */
export interface RequestsDraft {
  readonly requests: readonly string[];
  readonly answers: readonly string[];
  readonly turn: { readonly column: number; readonly value: string } | null;
  readonly gapHours: number | null;
  /** Set by the analyst after reading the definition in words; any change of the definition clears it. */
  readonly reviewed: boolean;
}

export const emptyDraft: RequestsDraft = { requests: [], answers: [], turn: null, gapHours: null, reviewed: false };

/** Why the definition cannot be read yet, or null when it can. */
export function draftProblem(draft: RequestsDraft): string | null {
  if (draft.requests.length === 0) return "Choose at least one request activity.";
  if (draft.answers.length === 0) return "Choose at least one answer activity.";
  const both = draft.requests.find((activity) => draft.answers.includes(activity));
  if (both) return `“${both}” cannot be both a request and an answer.`;
  if (draft.gapHours !== null && !(draft.gapHours > 0)) return "A gap that starts a new matter must be more than zero hours, or none.";
  return null;
}

const listed = (activities: readonly string[]) =>
  activities.length === 1 ? `“${activities[0]}”` : `${activities.slice(0, -1).map((activity) => `“${activity}”`).join(", ")} or “${activities.at(-1)}”`;

/** The definition in words, as the analyst reviews it. */
export function definitionWords(draft: RequestsDraft, columnName: (index: number) => string): string {
  const turn = draft.turn ? ` recorded while ${columnName(draft.turn.column)} is “${draft.turn.value}”` : "";
  const matter = draft.gapHours === null
    ? "The whole recorded history of a case is one matter."
    : `A record more than ${draft.gapHours.toLocaleString("en")} hours after the record before it starts a new matter, and only the latest matter of a case is read.`;
  return `A request is a record of ${listed(draft.requests)}${turn}; an answer is a record of ${listed(draft.answers)}. ${matter} ` +
    "A case is listed when its last request in that matter has no later answer in the records of the export.";
}

/** The definition as the local service reads it. */
export const definitionOf = (draft: RequestsDraft): RequestDefinition => ({
  request_activities: [...draft.requests] as [string, ...string[]],
  answer_activities: [...draft.answers] as [string, ...string[]],
  turn: draft.turn ? { column_index: draft.turn.column, value: draft.turn.value } : null,
  gap_hours: draft.gapHours,
});

/** A reviewed definition as a saved investigation holds it, bound to its preparation. */
export function toPresentation(draft: RequestsDraft, preparationId: string): RequestsPresentation {
  const definition = definitionOf(draft);
  return { preparation_id: preparationId, ...definition, request_activities: [...draft.requests] as [string, ...string[]],
    answer_activities: [...draft.answers] as [string, ...string[]], reviewed: true };
}

export function fromPresentation(saved: RequestsPresentation): RequestsDraft {
  return { requests: saved.request_activities, answers: saved.answer_activities, turn: saved.turn ? { column: saved.turn.column_index, value: saved.turn.value } : null,
    gapHours: saved.gap_hours, reviewed: true };
}

/** The reading a definition is made for. */
export interface RequestsReading {
  workspaceId: string;
  preparationId: string;
}

export type RequestsNotice = { kind: "restored"; investigation: string } | { kind: "not_applied"; investigation: string; message: string };

export interface RequestsState {
  draft: RequestsDraft;
  notice?: RequestsNotice;
}

const memoryKey = "wise-platform.requests";
const keyOf = ({ workspaceId, preparationId }: RequestsReading) => `${memoryKey}:${workspaceId}:${preparationId}`;

/** A draft as it was kept, or none where it is not of the kept form. */
function readDraft(kept: unknown): RequestsDraft | null {
  if (typeof kept !== "object" || kept === null) return null;
  const { requests, answers, turn, gapHours, reviewed } = kept as Record<string, unknown>;
  const names = (value: unknown) => (Array.isArray(value) && value.every((item) => typeof item === "string") ? (value as string[]) : null);
  const readTurn = typeof turn === "object" && turn !== null && Number.isInteger((turn as { column?: unknown }).column) && typeof (turn as { value?: unknown }).value === "string"
    ? (turn as { column: number; value: string }) : null;
  if (!names(requests) || !names(answers)) return null;
  return { requests: names(requests)!, answers: names(answers)!, turn: readTurn, gapHours: typeof gapHours === "number" && gapHours > 0 ? gapHours : null, reviewed: reviewed === true };
}

/**
 * The definitions of requests and answers of the readings shown on this page, kept in the browser for each reading, and
 * restored from a reopened investigation that saved one.
 */
export class RequestsStore {
  private readonly states = new Map<string, RequestsState>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = typeof window === "undefined" ? null : window.localStorage) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  stateOf(reading: RequestsReading): RequestsState {
    const key = keyOf(reading);
    let state = this.states.get(key);
    if (!state) {
      let kept: RequestsDraft | null = null;
      try { kept = readDraft(JSON.parse(this.storage?.getItem(key) ?? "null")); } catch { kept = null; }
      state = { draft: kept ?? emptyDraft };
      this.states.set(key, state);
    }
    return state;
  }

  private set(reading: RequestsReading, state: RequestsState) {
    this.states.set(keyOf(reading), state);
    try { this.storage?.setItem(keyOf(reading), JSON.stringify(state.draft)); } catch { /* Keeping is a convenience. */ }
    for (const listener of this.listeners) listener();
  }

  /** Changes the definition; a change of what it means clears the review, which must be given again. */
  change(reading: RequestsReading, change: (draft: RequestsDraft) => RequestsDraft): void {
    const before = this.stateOf(reading).draft;
    const next = change(before);
    if (next === before) return;
    const meaning = (draft: RequestsDraft) => JSON.stringify({ ...draft, reviewed: false });
    this.set(reading, { draft: meaning(next) === meaning(before) ? next : { ...next, reviewed: false } });
  }

  restore(reading: RequestsReading, draft: RequestsDraft | null, notice: RequestsNotice): void {
    this.set(reading, { draft: draft ?? this.stateOf(reading).draft, notice });
  }
}

export const browserRequests = new RequestsStore();

export function useRequests(reading: RequestsReading, store: RequestsStore = browserRequests): RequestsState {
  return useSyncExternalStore(store.subscribe, () => store.stateOf(reading));
}
