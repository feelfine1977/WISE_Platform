/** A stage of a log, as the analyst named it. */
export interface Stage {
  /** Names the stage on the map and in what is kept; it stays the same when the stage is renamed or moved. */
  readonly id: string;
  readonly name: string;
}

/**
 * The stages of a log and the stage of each of its activities. Which stages a log has and what
 * belongs to them is the analyst's reading of that log: nothing here is built in, and nothing is
 * derived from the records. Every change gives new definitions; those given are never changed.
 */
export interface StageDefinitions {
  /** The stages in their order, the earliest first. */
  readonly stages: readonly Stage[];
  /** The id of the stage of each activity that has one, by the activity's name; an activity without an entry is in no stage. */
  readonly assigned: ReadonlyMap<string, string>;
}

export const noStages: StageDefinitions = { stages: [], assigned: new Map() };

const STAGE_ID = "stage:";

/**
 * Whether an id is one this module gives a stage: no other id is taken from what was kept. Its
 * number has at most fifteen digits, so that the number after it is still told apart from it; a
 * longer one, which only a damaged store can hold, is not a stage id.
 */
export const isStageId = (id: string) => /^stage:[1-9]\d{0,14}$/.test(id);

/** A name as it is given to a stage: without space around it or runs of space inside it. */
export const stageName = (name: string) => name.trim().replace(/\s+/g, " ");

/** Why a stage cannot be called so: no name is left, or another stage has it; null when it can. */
export function nameProblem(definitions: StageDefinitions, name: string, stageId?: string): "empty" | "taken" | null {
  const wanted = stageName(name).toLocaleLowerCase();
  if (wanted === "") return "empty";
  return definitions.stages.some((stage) => stage.id !== stageId && stage.name.toLocaleLowerCase() === wanted) ? "taken" : null;
}

/** Adds a stage after the others. A name that cannot be given adds none. */
export function withStage(definitions: StageDefinitions, name: string): StageDefinitions {
  if (nameProblem(definitions, name) !== null) return definitions;
  const latest = definitions.stages.reduce((most, stage) => Math.max(most, Number(stage.id.slice(STAGE_ID.length))), 0);
  const taken = new Set(definitions.stages.map((stage) => stage.id));
  let id = `${STAGE_ID}${latest + 1}`;
  // After the largest id that can be a stage's, the next one is the smallest that is free: a new stage always gets an id that is one and that no other has.
  for (let number = 1; !isStageId(id) || taken.has(id); number += 1) id = `${STAGE_ID}${number}`;
  return { ...definitions, stages: [...definitions.stages, { id, name: stageName(name) }] };
}

/** Renames a stage; its place and its activities stay. A name that cannot be given changes nothing. */
export function renamed(definitions: StageDefinitions, stageId: string, name: string): StageDefinitions {
  const stage = definitions.stages.find((item) => item.id === stageId);
  if (!stage || stage.name === stageName(name) || nameProblem(definitions, name, stageId) !== null) return definitions;
  return { ...definitions, stages: definitions.stages.map((item) => (item === stage ? { ...item, name: stageName(name) } : item)) };
}

/** Removes a stage; its activities are in no stage afterwards. */
export function withoutStage(definitions: StageDefinitions, stageId: string): StageDefinitions {
  if (!definitions.stages.some((stage) => stage.id === stageId)) return definitions;
  return {
    stages: definitions.stages.filter((stage) => stage.id !== stageId),
    assigned: new Map([...definitions.assigned].filter(([, assignedTo]) => assignedTo !== stageId)),
  };
}

/** Moves a stage one place earlier or later; the first stage moves no earlier and the last no later. */
export function moved(definitions: StageDefinitions, stageId: string, direction: "earlier" | "later"): StageDefinitions {
  const from = definitions.stages.findIndex((stage) => stage.id === stageId);
  const to = direction === "earlier" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= definitions.stages.length) return definitions;
  const stages = [...definitions.stages];
  [stages[from], stages[to]] = [stages[to], stages[from]];
  return { ...definitions, stages };
}

/** Puts an activity into a stage, or into none (null). A stage that is not defined changes nothing. */
export function withActivity(definitions: StageDefinitions, activity: string, stageId: string | null): StageDefinitions {
  if ((definitions.assigned.get(activity) ?? null) === stageId) return definitions;
  if (stageId !== null && !definitions.stages.some((stage) => stage.id === stageId)) return definitions;
  const assigned = new Map(definitions.assigned);
  if (stageId === null) assigned.delete(activity);
  else assigned.set(activity, stageId);
  return { ...definitions, assigned };
}

/**
 * The definitions as they are written down to be kept: the stages in their order, and the
 * activities with their stage as pairs, since an activity may have any name.
 */
export function written(definitions: StageDefinitions): { stages: Stage[]; assigned: [string, string][] } {
  return { stages: definitions.stages.map(({ id, name }) => ({ id, name })), assigned: [...definitions.assigned] };
}

/**
 * The definitions read from what was kept, whatever was kept: a stage without a name, with an id
 * that is not a stage's or with the id of an earlier stage is left out, and so is an activity
 * whose stage is not among those left. Anything that is not of the written form gives no stage.
 */
export function read(kept: unknown): StageDefinitions {
  if (typeof kept !== "object" || kept === null) return noStages;
  const { stages: keptStages, assigned: keptAssigned } = kept as Record<string, unknown>;
  const stages: Stage[] = [];
  for (const item of Array.isArray(keptStages) ? keptStages : []) {
    if (typeof item !== "object" || item === null) continue;
    const { id, name } = item as Record<string, unknown>;
    if (typeof id !== "string" || typeof name !== "string" || !isStageId(id) || stageName(name) === "") continue;
    if (!stages.some((stage) => stage.id === id)) stages.push({ id, name: stageName(name) });
  }
  if (stages.length === 0) return noStages;
  const assigned = new Map<string, string>();
  for (const pair of Array.isArray(keptAssigned) ? keptAssigned : []) {
    if (!Array.isArray(pair)) continue;
    const [activity, stageId] = pair as unknown[];
    if (typeof activity === "string" && typeof stageId === "string" && stages.some((stage) => stage.id === stageId)) assigned.set(activity, stageId);
  }
  return { stages, assigned };
}
