import { countOf, utcText, wallText } from "../data/wording";
import type { ImportedSourceRecord2 } from "../generated/imports";
import type { Clock, Gap, LongestGap, RecordTime, Strip, Timeline } from "./timeline";

const quoted = (text: string) => `“${text}”`;

const oneDecimal = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const SECOND = 1_000_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A difference of two recorded times in words, as the map words its times: in hours below 48 hours
 * and in days from there on, each with one decimal. A gap between two records is often shorter than
 * a time of the map, so below one hour it is said in minutes and below one minute in seconds.
 */
export function elapsedText(microseconds: number): string {
  // A difference that one decimal of a second would write as none is said to be there.
  if (microseconds > 0 && microseconds < SECOND / 20) return "less than 0.1 seconds";
  if (microseconds < MINUTE) return `${oneDecimal.format(microseconds / SECOND)} seconds`;
  if (microseconds < HOUR) return `${oneDecimal.format(microseconds / MINUTE)} minutes`;
  if (microseconds < 48 * HOUR) return `${oneDecimal.format(microseconds / HOUR)} hours`;
  return `${oneDecimal.format(microseconds / DAY)} days`;
}

/** The readable time of a record as the list writes it. */
export function timeText(record: RecordTime): string {
  if (record.utc_instant !== null) return utcText(record.utc_instant);
  if (record.local_timestamp !== null) return wallText(record.local_timestamp);
  return "no readable time";
}

type ListedRecord = RecordTime & Pick<ImportedSourceRecord2, "activity" | "source_position">;

/** A record as the longest gap names it: its activity, its time and its place in the source, as the list shows them. */
export function recordName(record: ListedRecord): string {
  const activity = record.activity === null ? "a record without activity label" : quoted(record.activity);
  return `${activity} (${timeText(record)}, source position ${record.source_position})`;
}

/** What a mark stands for: its time, how far it lies from the earliest one, and its records. */
export function markLabel(time: string, recordCount: number, sinceEarliest: number): string {
  const where = sinceEarliest === 0 ? "the earliest recorded time" : `${elapsedText(sinceEarliest)} after the earliest recorded time`;
  return `${time}, ${where}: ${countOf(recordCount, "record")}`;
}

/** How the strip is read and used. */
export const STRIP_HINT =
  "One mark for each distinct recorded time, placed by the time elapsed since the earliest. A count above a mark says how many records " +
  "carry exactly that time. Select a mark to go to its first record in the list; the left and right arrow keys move between the marks.";

/** Why there is no axis: the sentence that stands in its place. `time` is the one readable time, where there is one. */
export function noAxisLine(strip: Exclude<Strip, { kind: "axis" }>, recordCount: number, time: string): string {
  const nothing = "there is no elapsed time to draw.";
  switch (strip.kind) {
    case "no_time":
      return `No record of this incident has a readable time; ${nothing}`;
    case "two_clocks":
      return "The records of this incident carry times of two kinds, UTC instants and wall-clock times as recorded. These are not compared, so nothing is drawn.";
    case "one_time": {
      const timed = strip.mark.records.length;
      const untimed = recordCount - timed;
      if (recordCount === 1) return `This incident has one record, at ${time}; ${nothing}`;
      if (timed === 1) return `Only one of the ${countOf(recordCount, "record")} of this incident has a readable time, ${time}; ${nothing}`;
      if (untimed === 0) return `${timed === 2 ? "Both records" : `All ${countOf(timed, "record")}`} of this incident carry the same recorded time, ${time}; ${nothing}`;
      return (
        `The ${countOf(timed, "record")} with a readable time carry the same recorded time, ${time}, ` +
        `and ${countOf(untimed, "record")} ${untimed === 1 ? "has" : "have"} no readable time; ${nothing}`
      );
    }
  }
}

/** How many records are on no mark of the strip. */
export function untimedLine(count: number): string {
  return `${countOf(count, "record")} without a readable time ${count === 1 ? "is" : "are"} not on the strip.`;
}

/** How many records without a readable time are offered by name under the strip; the others are in the list. */
export const UNTIMED_SHOWN = 24;

/** What follows the records without a readable time that are offered by name, when there are more of them. */
export function untimedRest(count: number): string | null {
  return count > UNTIMED_SHOWN ? `and ${countOf(count - UNTIMED_SHOWN, "more record")} in the list below` : null;
}

/** The gap before a record as its line in the list, or null for the first record, before which no record lies. */
export function gapLine(gap: Gap): string | null {
  const said = "Gap since the record before:";
  switch (gap.kind) {
    case "first":
      return null;
    case "elapsed":
      return gap.microseconds === 0 ? `${said} none, the same recorded time` : `${said} ${elapsedText(gap.microseconds)}`;
    case "earlier":
      return `${said} not computed; the time of this record lies ${elapsedText(gap.microseconds)} before the time of the record before`;
    case "untimed":
      return gap.record === "this" ? `${said} not computed; this record has no readable time` : `${said} not computed; the record before has no readable time`;
  }
}

/** The longest gap in two parts: its length, and the two records it lies between. */
export function longestGapWords(longest: LongestGap, from: ListedRecord, to: ListedRecord): [string, string] {
  const first = longest.equalCount > 1 ? ` It is the first of ${longest.equalCount} gaps of this length in the declared order.` : "";
  // No gap above zero: consecutive records carry the same recorded time, which is said as it is and not left out.
  const length = longest.microseconds === 0 ? "Longest gap: none above zero" : `Longest gap: ${elapsedText(longest.microseconds)}`;
  return [length, `between ${recordName(from)} and ${recordName(to)}.${first}`];
}

/** Why no gap is computed for any record of the incident. */
export function withheldLine(reason: NonNullable<Timeline["withheld"]>): string {
  return reason === "order"
    ? "No gap is computed for this incident: the local service says that the order of its records cannot be evaluated, so it is not known which record follows which."
    : "No gap is computed for this incident: a UTC instant and a wall-clock time as recorded are not compared.";
}

/** Where the numbers of the timeline come from, and what a recorded wall clock does not say. */
export function basisLine(clock: Clock | null): string {
  const basis = "The elapsed times here are plain differences of the recorded times shown in the list, computed in this browser and not supplied by the local service.";
  return clock === "wall_clock"
    ? `${basis} The times are wall-clock times as recorded; across a clock change a difference may differ from the physical elapsed time.`
    : basis;
}
