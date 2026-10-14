import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { earlierPreparationId, preparationId, workspaceId } from "../test/imports";
import { noStages, type StageDefinitions, withActivity, withStage } from "./definitions";
import { browserStageMemory, type StagedReading, type StageMemory, StageStore } from "./store";

const reading: StagedReading = { workspaceId, preparationId };
const otherReading: StagedReading = { workspaceId, preparationId: earlierPreparationId };
const otherWorkspace: StagedReading = { workspaceId: "workspace.v1:fedcba9876543210", preparationId };

const twoStages = withActivity(withStage(withStage(noStages, "Intake"), "Closure"), "Eröffnet", "stage:1");

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("the stages kept in the browser", () => {
  it("keeps the stages of a reading and recalls them for that reading alone", () => {
    expect(browserStageMemory.recall(reading)).toBe(noStages);
    expect(browserStageMemory.remember(reading, twoStages)).toBe(true);
    expect(browserStageMemory.recall(reading)).toEqual(twoStages);
    // Another preparation and another workspace are other logs: they have their own stages, or none.
    expect(browserStageMemory.recall(otherReading)).toBe(noStages);
    expect(browserStageMemory.recall(otherWorkspace)).toBe(noStages);
    const other = withStage(noStages, "Customer side");
    browserStageMemory.remember(otherReading, other);
    expect(browserStageMemory.recall(otherReading)).toEqual(other);
    expect(browserStageMemory.recall(reading)).toEqual(twoStages);
    expect(window.localStorage.length).toBe(2);
  });

  it("keeps nothing for a reading without a stage", () => {
    browserStageMemory.remember(reading, twoStages);
    expect(window.localStorage.length).toBe(1);
    expect(browserStageMemory.remember(reading, noStages)).toBe(true);
    expect(window.localStorage.length).toBe(0);
    expect(browserStageMemory.recall(reading)).toBe(noStages);
  });

  it("starts without stages where what is kept cannot be read", () => {
    browserStageMemory.remember(reading, twoStages);
    const key = window.localStorage.key(0)!;
    for (const kept of ["{", "null", "7", '"stages"', '{"stages":{}}', '{"stages":[{"id":"event:start","name":"Start"}]}']) {
      window.localStorage.setItem(key, kept);
      expect(browserStageMemory.recall(reading), kept).toBe(noStages);
    }
  });

  it("says so where the browser gives no storage, and keeps nothing", () => {
    const denied = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(denied);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(denied);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(denied);
    expect(browserStageMemory.recall(reading)).toBeNull();
    expect(browserStageMemory.remember(reading, twoStages)).toBe(false);
    expect(browserStageMemory.remember(reading, noStages)).toBe(false);
  });
});

/** A memory in which the test sees what is kept, and which can refuse to keep. */
function scriptedMemory(kept: StageDefinitions | null = noStages) {
  const remembered: [StagedReading, StageDefinitions][] = [];
  const recalls: StagedReading[] = [];
  const memory: StageMemory & { keeps: boolean } = {
    keeps: true,
    recall(asked) {
      recalls.push(asked);
      return kept;
    },
    remember(asked, definitions) {
      if (memory.keeps) remembered.push([asked, definitions]);
      return memory.keeps;
    },
  };
  return { memory, remembered, recalls };
}

describe("the stages of the readings shown on a page", () => {
  it("holds the stages of a reading as they are kept, and reads them once", () => {
    const { memory, recalls } = scriptedMemory(twoStages);
    const store = new StageStore(memory);
    const state = store.stateOf(reading);
    expect(state).toEqual({ definitions: twoStages, kept: true, revision: 0 });
    // The same state for as long as nothing changes: a component that follows it is not drawn again for nothing.
    expect(store.stateOf({ ...reading })).toBe(state);
    expect(recalls).toEqual([reading]);
  });

  it("keeps every change at once and tells those that follow", () => {
    const { memory, remembered } = scriptedMemory();
    const store = new StageStore(memory);
    let told = 0;
    const stop = store.subscribe(() => (told += 1));
    store.change(reading, (definitions) => withStage(definitions, "Intake"));
    expect(told).toBe(1);
    expect(store.stateOf(reading)).toEqual({ definitions: withStage(noStages, "Intake"), kept: true, revision: 1 });
    expect(remembered).toEqual([[reading, withStage(noStages, "Intake")]]);

    // A change that gives the same definitions is none: nothing is kept again and nobody is told.
    const before = store.stateOf(reading);
    store.change(reading, (definitions) => withStage(definitions, "intake"));
    expect(store.stateOf(reading)).toBe(before);
    expect(told).toBe(1);
    expect(remembered).toHaveLength(1);

    stop();
    store.change(reading, (definitions) => withStage(definitions, "Closure"));
    expect(told).toBe(1);
    expect(store.stateOf(reading).revision).toBe(2);
  });

  it("holds the stages of each reading apart", () => {
    const store = new StageStore(scriptedMemory().memory);
    store.change(reading, (definitions) => withStage(definitions, "Intake"));
    expect(store.stateOf(otherReading)).toEqual({ definitions: noStages, kept: true, revision: 0 });
    expect(store.stateOf(otherWorkspace).definitions).toBe(noStages);
    expect(store.stateOf(reading).definitions.stages).toHaveLength(1);
  });

  it("goes on with stages that cannot be kept, and says that they are not", () => {
    const unavailable = new StageStore(scriptedMemory(null).memory);
    expect(unavailable.stateOf(reading)).toEqual({ definitions: noStages, kept: false, revision: 0 });

    const { memory } = scriptedMemory();
    const store = new StageStore(memory);
    memory.keeps = false;
    store.change(reading, (definitions) => withStage(definitions, "Intake"));
    // The stages are there for as long as the page is.
    expect(store.stateOf(reading)).toEqual({ definitions: withStage(noStages, "Intake"), kept: false, revision: 1 });
    memory.keeps = true;
    store.change(reading, (definitions) => withStage(definitions, "Closure"));
    expect(store.stateOf(reading).kept).toBe(true);
  });

  it("shows on a page opened later what an earlier one kept in the browser", () => {
    const earlier = new StageStore();
    earlier.change(reading, () => twoStages);
    const later = new StageStore();
    expect(later.stateOf(reading)).toEqual({ definitions: twoStages, kept: true, revision: 0 });
    expect(later.stateOf(otherReading).definitions).toBe(noStages);
  });
});
