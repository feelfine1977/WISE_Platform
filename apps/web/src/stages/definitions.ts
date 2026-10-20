import type { StagesPresentation } from "../generated/saving";

/** A stage of a log, as the analyst named it. */
export interface Stage {
  /** Names the stage on the map and in what is kept; it stays the same when the stage is renamed or moved. */
  readonly id: string;
  readonly name: string;
}

/**
 * Where the stage of an activity came from: set by hand, or taken by the analyst from a value of
 * the phase column that the proposal listed for the activity's records. A proposal never assigns.
 */
export type StageOrigin = { readonly kind: "manual" } | { readonly kind: "proposed"; readonly column: number; readonly value: string };

/**
 * The stages of a log and the stage of each of its activities. Which stages a log has and what
 * belongs to them is the analyst's reading of that log: nothing here is built in, and a value of
 * the records becomes a stage only when the analyst takes it. Every change gives new definitions;
 * those given are never changed.
 */
export interface StageDefinitions {
  /** The stages in their order, the earliest first. */
  readonly stages: readonly Stage[];
  /** The id of the stage of each activity that has one, by the activity's name; an activity without an entry is in no stage. */
  readonly assigned: ReadonlyMap<string, string>;
  /** Where the stage of each assigned activity came from; an activity without an entry was set by hand. */
  readonly origins?: ReadonlyMap<string, StageOrigin>;
  /** The context column the analyst reads the phase of a record from, when one was chosen. */
  readonly phaseColumn?: number | null;
}

export const noStages: StageDefinitions = { stages: [], assigned: new Map() };

const MANUAL: StageOrigin = { kind: "manual" };

/** The definitions without an empty map of origins or an unnamed phase column, so that equal definitions are written alike. */
function tidy(definitions: StageDefinitions): StageDefinitions {
  const { origins, phaseColumn, ...rest } = definitions;
  return { ...rest, ...(origins && origins.size > 0 ? { origins } : {}), ...(phaseColumn != null ? { phaseColumn } : {}) };
}

/** Where the stage of an activity came from; set by hand unless it was taken from a proposal. */
export const originOf = (definitions: StageDefinitions, activity: string): StageOrigin => definitions.origins?.get(activity) ?? MANUAL;

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
  const assigned = new Map([...definitions.assigned].filter(([, assignedTo]) => assignedTo !== stageId));
  return tidy({
    ...definitions,
    stages: definitions.stages.filter((stage) => stage.id !== stageId),
    assigned,
    origins: new Map([...(definitions.origins ?? [])].filter(([activity]) => assigned.has(activity))),
  });
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

/**
 * Puts an activity into a stage, or into none (null), by hand unless an origin is given. A stage
 * that is not defined changes nothing.
 */
export function withActivity(definitions: StageDefinitions, activity: string, stageId: string | null, origin: StageOrigin = MANUAL): StageDefinitions {
  const sameOrigin = JSON.stringify(originOf(definitions, activity)) === JSON.stringify(origin);
  if ((definitions.assigned.get(activity) ?? null) === stageId && (stageId === null || sameOrigin)) return definitions;
  if (stageId !== null && !definitions.stages.some((stage) => stage.id === stageId)) return definitions;
  const assigned = new Map(definitions.assigned);
  const origins = new Map(definitions.origins ?? []);
  if (stageId === null) {
    assigned.delete(activity);
    origins.delete(activity);
  } else {
    assigned.set(activity, stageId);
    if (origin.kind === "manual") origins.delete(activity);
    else origins.set(activity, origin);
  }
  return tidy({ ...definitions, assigned, origins });
}

/**
 * Takes a value the proposal listed for an activity: the activity goes into the stage of that
 * name, which is added after the others when there is none yet, and keeps where its stage came
 * from. A value that cannot be a stage's name changes nothing.
 */
export function withProposed(definitions: StageDefinitions, activity: string, column: number, value: string): StageDefinitions {
  const wanted = stageName(value).toLocaleLowerCase();
  const withIt = definitions.stages.some((stage) => stage.name.toLocaleLowerCase() === wanted) ? definitions : withStage(definitions, value);
  const stage = withIt.stages.find((item) => item.name.toLocaleLowerCase() === wanted);
  return stage ? withActivity(withIt, activity, stage.id, { kind: "proposed", column, value }) : definitions;
}

/** Names the context column the phase of a record is read from, or none. */
export function withPhaseColumn(definitions: StageDefinitions, column: number | null): StageDefinitions {
  return (definitions.phaseColumn ?? null) === column ? definitions : tidy({ ...definitions, phaseColumn: column });
}

/** The activities put into a stage that the log does not have: they are drawn nowhere and are said, never applied silently. */
export function staleActivities(definitions: StageDefinitions, activities: ReadonlySet<string>): string[] {
  return [...definitions.assigned.keys()].filter((activity) => !activities.has(activity)).sort();
}

/** Takes the activities the log does not have out of their stages. */
export function withoutActivities(definitions: StageDefinitions, gone: readonly string[]): StageDefinitions {
  return gone.reduce((current, activity) => withActivity(current, activity, null), definitions);
}

/**
 * The definitions as they are written down to be kept: the stages in their order, and the
 * activities with their stage as pairs, since an activity may have any name.
 */
export function written(definitions: StageDefinitions): { stages: Stage[]; assigned: [string, string][]; origins: [string, StageOrigin][]; phaseColumn: number | null } {
  return {
    stages: definitions.stages.map(({ id, name }) => ({ id, name })),
    assigned: [...definitions.assigned],
    origins: [...(definitions.origins ?? [])].filter(([activity]) => definitions.assigned.has(activity)),
    phaseColumn: definitions.phaseColumn ?? null,
  };
}

/** An origin as it was kept, or none where it is not of the written form. */
function originRead(kept: unknown): StageOrigin | null {
  if (typeof kept !== "object" || kept === null) return null;
  const { kind, column, value } = kept as Record<string, unknown>;
  if (kind === "manual") return MANUAL;
  return kind === "proposed" && Number.isInteger(column) && (column as number) >= 0 && typeof value === "string" && value !== ""
    ? { kind: "proposed", column: column as number, value }
    : null;
}

/**
 * The definitions read from what was kept, whatever was kept: a stage without a name, with an id
 * that is not a stage's or with the id of an earlier stage is left out, and so is an activity
 * whose stage is not among those left. Anything that is not of the written form gives no stage.
 */
export function read(kept: unknown): StageDefinitions {
  if (typeof kept !== "object" || kept === null) return noStages;
  const { stages: keptStages, assigned: keptAssigned, origins: keptOrigins, phaseColumn: keptPhase } = kept as Record<string, unknown>;
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
  const origins = new Map<string, StageOrigin>();
  for (const pair of Array.isArray(keptOrigins) ? keptOrigins : []) {
    if (!Array.isArray(pair)) continue;
    const [activity, origin] = pair as unknown[];
    const readOrigin = originRead(origin);
    if (typeof activity === "string" && assigned.has(activity) && readOrigin !== null && readOrigin.kind === "proposed") origins.set(activity, readOrigin);
  }
  const phaseColumn = Number.isInteger(keptPhase) && (keptPhase as number) >= 0 ? (keptPhase as number) : null;
  return tidy({ stages, assigned, origins, phaseColumn });
}

/** The stages as a saved investigation holds them, bound to the preparation they are defined for. */
export function toPresentation(definitions: StageDefinitions, preparationId: string): StagesPresentation {
  return {
    preparation_id: preparationId,
    phase_column_index: definitions.phaseColumn ?? null,
    stages: definitions.stages.map(({ id, name }) => ({ id, name })),
    assignments: [...definitions.assigned].map(([activity, stageId]) => {
      const origin = originOf(definitions, activity);
      return { activity, stage_id: stageId, origin: origin.kind === "manual" ? { kind: "manual" as const } : { kind: "proposed" as const, column_index: origin.column, value: origin.value } };
    }),
  };
}

/** The stages a saved investigation holds, read as kept stages are: what cannot be a stage is left out. */
export function fromPresentation(saved: StagesPresentation): StageDefinitions {
  return read({
    stages: saved.stages,
    assigned: saved.assignments.map((assignment) => [assignment.activity, assignment.stage_id]),
    origins: saved.assignments.map((assignment) => [assignment.activity,
      assignment.origin.kind === "manual" ? { kind: "manual" } : { kind: "proposed", column: assignment.origin.column_index, value: assignment.origin.value }]),
    phaseColumn: saved.phase_column_index,
  });
}
