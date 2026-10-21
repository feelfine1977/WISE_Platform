import type { ImportedCaseEvidenceAnswer, ImportedSourceRecord } from "../generated/imports";
import { countOf, utcText, wallText } from "../data/wording";
import { stepWording } from "../map/wording";
import type { Pin, PinRole } from "../imported/coordinator";

export const ROLE_NAMES: Record<PinRole, string> = { supporting: "Supporting", contrary: "Contrary" };

/** Where a pinned history comes from: the selection's kept incidents, or its parent for an incident the selection removes. */
export function originLine(pin: Pin): string {
  const { question } = pin;
  const steps = question.steps.length === 0 ? "no step" : `${countOf(question.steps.length, "step")}: ${question.steps.map(stepWording).join("; ")}`;
  return pin.side === "kept"
    ? `Kept by the selection: one of ${countOf(question.kept, "incident")} of ${countOf(question.parent, "incident")}, under ${steps}.`
    : `Removed by the selection: one of ${countOf(question.removed, "incident")} it removes, read in its parent of ${countOf(question.parent, "incident")}, under ${steps}.`;
}

/** The start of a population identity, enough to tell two populations apart on screen; the pin holds all of it. */
export function shortPopulation(populationId: string): string {
  return populationId.slice(populationId.lastIndexOf(":") + 1, populationId.lastIndexOf(":") + 9);
}

/** The time of a record as recorded, or why it has none. */
export function recordTime(record: ImportedSourceRecord): string {
  if (record.timestamp_status === "missing") return "no time";
  if (record.timestamp_status === "invalid") return "time not readable";
  if (record.utc_instant !== null) return utcText(record.utc_instant);
  if (record.local_timestamp !== null) return wallText(record.local_timestamp);
  return "no time";
}

/**
 * What a reader should notice at each record of a complete history, in the declared order: a record without an activity
 * label (left out of the sequence), an activity met before (a repeat), the same usable time as the record before (a tie,
 * ordered by the declared rule), no usable time, and context values that differ from the record before.
 */
export function historyMarks(answer: ImportedCaseEvidenceAnswer): string[][] {
  const names = new Map(answer.columns.map((column) => [column.index, column.name === "" ? `column ${column.index}` : column.name]));
  const seen = new Set<string>();
  return answer.records.map((record, place) => {
    const marks: string[] = [];
    const before = place > 0 ? answer.records[place - 1] : null;
    if (record.activity === null) marks.push("no activity label: left out of the sequence");
    else if (seen.has(record.activity)) marks.push("repeat of an earlier activity");
    if (record.activity !== null) seen.add(record.activity);
    if (record.timestamp_status !== "usable") marks.push("no usable time");
    else if (before && before.timestamp_status === "usable" && recordTime(before) === recordTime(record)) marks.push("same time as the record before");
    if (before) {
      for (const value of record.context) {
        const earlier = before.context.find((candidate) => candidate.column_index === value.column_index);
        if (earlier && earlier.value !== value.value) marks.push(`${names.get(value.column_index) ?? `column ${value.column_index}`} changed`);
      }
    }
    return marks;
  });
}

export type ContextReading = "same value" | "different values" | "recorded on one side only" | "recorded on neither side";

/**
 * The context at the first record of each of two histories, column by column, read as it is: the same value, different
 * values, or not recorded on one or both sides. Nothing is matched or filled: a missing value stays missing.
 */
export function contextAtFirst(left: ImportedCaseEvidenceAnswer, right: ImportedCaseEvidenceAnswer) {
  const first = (answer: ImportedCaseEvidenceAnswer) => new Map(answer.records[0].context.map((value) => [value.column_index, value.value]));
  const [a, b] = [first(left), first(right)];
  const names = new Map([...left.columns, ...right.columns].map((column) => [column.index, column.name === "" ? `Column ${column.index}` : column.name]));
  const indexes = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y);
  return indexes.map((index) => {
    const [x, y] = [a.get(index) ?? null, b.get(index) ?? null];
    const reading: ContextReading = x === null && y === null ? "recorded on neither side" : x === null || y === null ? "recorded on one side only" : x === y ? "same value" : "different values";
    return { index, name: names.get(index) ?? `Column ${index}`, left: x, right: y, reading };
  });
}
