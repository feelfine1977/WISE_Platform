import { useSyncExternalStore } from "react";
import type { PreparationId, WorkspaceId } from "../generated/imports";
import { noStages, read, type StageDefinitions, written } from "./definitions";

/** The reading stages are defined for: one preparation of a source in a workspace. */
export interface StagedReading {
  workspaceId: WorkspaceId;
  preparationId: PreparationId;
}

/**
 * Where the stages of a reading are kept on this computer, so that a refresh and a restart show
 * them again. Saving an investigation saves its stages with it, and reopening it brings them back
 * for its reading; between the two the browser keeps the stages last shown for each reading.
 */
export interface StageMemory {
  /** The stages kept for the reading, none where nothing readable is kept; null where nothing can be kept here. */
  recall(reading: StagedReading): StageDefinitions | null;
  /** Keeps the stages of the reading in place of those kept before, and says whether it could. */
  remember(reading: StagedReading, definitions: StageDefinitions): boolean;
}

const memoryKey = "wise-platform.stages";

/** Each reading has its own entry, so that the stages of one log are never drawn on another. */
const keyOf = ({ workspaceId, preparationId }: StagedReading) => `${memoryKey}:${workspaceId}:${preparationId}`;

/** Kept in the browser's local storage; where that is not available, nothing is kept. */
export const browserStageMemory: StageMemory = {
  recall(reading) {
    let kept: string | null;
    try {
      kept = window.localStorage.getItem(keyOf(reading));
    } catch {
      return null;
    }
    try {
      return read(JSON.parse(kept ?? "null"));
    } catch {
      // What is kept cannot be read: the reading starts without stages.
      return noStages;
    }
  },
  remember(reading, definitions) {
    try {
      if (definitions.stages.length === 0) window.localStorage.removeItem(keyOf(reading));
      else window.localStorage.setItem(keyOf(reading), JSON.stringify(written(definitions)));
      return true;
    } catch {
      // Keeping is a convenience; the stages then last as long as the page does.
      return false;
    }
  },
};

/** The stages of a reading as this page holds them. */
export interface StagesState {
  definitions: StageDefinitions;
  /** Whether the definitions are kept in the browser; false once they could not be read from it or kept in it. */
  kept: boolean;
  /** How often the stages were changed on this page; a map arranged for earlier stages is arranged anew. */
  revision: number;
  /** What a reopened investigation said of its stages, until the stages are changed: from where they came, or why they were not applied. */
  notice?: StagesNotice;
}

/** What reopening an investigation did with the stages saved with it. */
export type StagesNotice =
  | { kind: "restored"; investigation: string }
  | { kind: "not_applied"; investigation: string; message: string };

/**
 * The stages of the readings shown on this page. The editor changes them and the map draws them,
 * wherever the two are mounted: both follow the same state, and every change is kept at once.
 */
export class StageStore {
  private readonly states = new Map<string, StagesState>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly memory: StageMemory = browserStageMemory) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The stages of a reading: as they were last changed on this page, else as they are kept. */
  stateOf(reading: StagedReading): StagesState {
    const key = keyOf(reading);
    let state = this.states.get(key);
    if (!state) {
      const recalled = this.memory.recall(reading);
      state = { definitions: recalled ?? noStages, kept: recalled !== null, revision: 0 };
      this.states.set(key, state);
    }
    return state;
  }

  /** Changes the stages of a reading and keeps the result; a change that gives the same definitions is none. */
  change(reading: StagedReading, change: (definitions: StageDefinitions) => StageDefinitions): void {
    const before = this.stateOf(reading);
    const definitions = change(before.definitions);
    if (definitions === before.definitions) return;
    this.states.set(keyOf(reading), { definitions, kept: this.memory.remember(reading, definitions), revision: before.revision + 1 });
    for (const listener of this.listeners) listener();
  }

  /**
   * Shows the stages a reopened investigation saved for its reading, in place of those shown for it
   * before, and says where they came from; with none saved, the stages shown stay and nothing is said.
   */
  restore(reading: StagedReading, definitions: StageDefinitions | null, notice: StagesNotice): void {
    const before = this.stateOf(reading);
    const next = definitions ?? before.definitions;
    this.states.set(keyOf(reading), {
      definitions: next,
      kept: definitions === null ? before.kept : this.memory.remember(reading, next),
      revision: before.revision + (definitions === null ? 0 : 1),
      notice,
    });
    for (const listener of this.listeners) listener();
  }
}

/** The stages kept in this browser. */
export const browserStages = new StageStore();

/** The stages of a reading, followed as they change. */
export function useStages(reading: StagedReading, store: StageStore = browserStages): StagesState {
  return useSyncExternalStore(store.subscribe, () => store.stateOf(reading));
}
