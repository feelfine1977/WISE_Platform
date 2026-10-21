import { utcText, wallText } from "../data/wording";
import type { ExplorerCaseSummary, MaximumRawGapWitness } from "../generated/case-list";
import { durationName } from "./periods";

/** An activity as a reader meets it in a sentence; a record without one is named as such, never left out. */
export function activityName(activity: string | null): string {
  return activity === null ? "a record without activity label" : `“${activity}”`;
}

/** A recorded time as the preparation keeps it: a UTC instant, or a wall-clock time as recorded. */
export function recordedAt(value: string, kind: "utc_instant" | "wall_clock"): string {
  return kind === "utc_instant" ? utcText(value) : wallText(value);
}

/** The part of the recorded span the longest gap takes, or why it has none: a zero span has no share. */
export function shareText(witness: MaximumRawGapWitness): string {
  return witness.share_of_observed_span === null ? "no share: the span is zero" : `${Math.round(witness.share_of_observed_span * 100)}% of the span`;
}

/** The two activities of a gap in the short form of a table cell. */
export function gapBetween(witness: MaximumRawGapWitness): string {
  const name = (activity: string | null) => activity ?? "no activity label";
  return `${name(witness.from_activity)} → ${name(witness.to_activity)}`;
}

/** The first record of an incident in the short form of a table cell, or null where the order is not known. */
export function firstRecordCell(row: ExplorerCaseSummary): string | null {
  const time = row.time_summary;
  if (time.status !== "available") return null;
  return recordedAt(time.first_recorded_timestamp, time.timestamp_kind);
}

/** The sentences on the time of one listed incident: its first and last records, its span, and its longest gap. */
export function timeSentences(row: ExplorerCaseSummary): string[] {
  const time = row.time_summary;
  if (time.status !== "available") {
    const unusable = time.unavailable_timestamp_record_count;
    return [
      `The order of its records is not fully known${unusable > 0 ? ` (${unusable} ${unusable === 1 ? "record has" : "records have"} no usable time)` : ""}: it has no span and no longest gap, and stands last in every order by time.`,
    ];
  }
  const sentences = [
    `First record ${recordedAt(time.first_recorded_timestamp, time.timestamp_kind)}, ${activityName(time.first_recorded_activity)}; last record ${recordedAt(time.last_recorded_timestamp, time.timestamp_kind)}, ${activityName(time.last_recorded_activity)}.`,
    `Recorded span ${durationName(time.observed_span_hours)}${row.record_count === 1 ? ": one record spans zero" : ""}.`,
  ];
  const witness = time.maximum_gap_witness;
  if (witness === null || time.maximum_adjacent_raw_gap_hours === null) {
    sentences.push("No longest gap: one record has no gap.");
  } else {
    sentences.push(
      `Longest gap ${durationName(time.maximum_adjacent_raw_gap_hours)}, from ${activityName(witness.from_activity)} to ${activityName(witness.to_activity)}, beginning ${durationName(witness.from_offset_hours)} after the first record; ${shareText(witness)}.`,
    );
  }
  if (time.tied_timestamp_group_count !== null && time.tied_timestamp_group_count > 0) {
    const groups = time.tied_timestamp_group_count;
    sentences.push(`${groups === 1 ? "One group of records shares" : `${groups} groups of records share`} a time; the gaps within ${groups === 1 ? "it" : "each"} are zero.`);
  }
  return sentences;
}
