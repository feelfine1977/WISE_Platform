import { describe, expect, it } from "vitest";
import literal from "../../../../tests/fixtures/incident-time/literal-cases.json";
import type { ImportedCaseEvidenceAnswer } from "../generated/imports";
import { stripOf, suppliedTimeline } from "./timeline";

/*
 * The 35 complete answers of the local service in the shared fixtures, each with its diagnostics,
 * against the independent table of what each must say: the exact gaps, the maximum, its two
 * records, the count of equal ones and the groups of tied times. The browser computes none of it.
 */
const answers = Object.values(
  import.meta.glob<ImportedCaseEvidenceAnswer>("../../../../tests/fixtures/incident-time/positive/*.json", { eager: true, import: "default" }),
);
interface LiteralCase {
  fixture: "utc_instant" | "wall_clock";
  case_id: string;
  protocol_name: string | null;
  sequence_evaluable: boolean;
  rows_in_expected_declared_order: { canonical_key: string | null }[];
  span_microseconds: string | null;
  gap_microseconds: (string | null)[] | null;
  maximum_gap_microseconds: string | null;
  equal_max_count: number | null;
  witness_indexes: [number, number] | null;
  tied_timestamp_group_count: number | null;
}
const cases = literal as LiteralCase[];
/** The answer a row of the table stands for: the same clock, incident and evaluability of its order, and the same history of records. */
const answerOf = (row: LiteralCase) =>
  answers.find(
    (answer) =>
      answer.incident_time?.timestamp_kind === row.fixture &&
      answer.case_id === row.case_id &&
      answer.sequence_evaluable === row.sequence_evaluable &&
      answer.incident_time.records.length === row.rows_in_expected_declared_order.length &&
      answer.incident_time.records.every((record, place) => record.timestamp_key === row.rows_in_expected_declared_order[place].canonical_key),
  );

describe("the timeline of an incident from the supplied diagnostics", () => {
  it("has an answer for every row of the table of expected values", () => {
    expect(answers).toHaveLength(35);
    expect(cases).toHaveLength(35);
    for (const row of cases) expect(answerOf(row), `${row.fixture} ${row.protocol_name ?? row.case_id}`).toBeDefined();
  });

  it("gives exactly the supplied gaps, the longest with its two records and the count of equal ones, or none where the order is not known", () => {
    for (const row of cases) {
      const answer = answerOf(row)!;
      const name = `${row.fixture} ${row.protocol_name ?? row.case_id}`;
      const timeline = suppliedTimeline(answer.records, answer.incident_time);
      expect(timeline.clock, name).toBe(row.fixture);
      if (row.span_microseconds === null) {
        expect(timeline.withheld, name).toBe("order");
        expect(timeline.gaps, name).toEqual([]);
        expect(timeline.longest, name).toBeNull();
        continue;
      }
      expect(timeline.withheld, name).toBeNull();
      expect(timeline.gaps.map((gap) => (gap.kind === "elapsed" ? gap.exact : null)), name).toEqual((row.gap_microseconds ?? []).map((gap) => (gap === null ? null : BigInt(gap))));
      if (row.witness_indexes === null) {
        expect(timeline.longest, name).toBeNull();
      } else {
        expect(timeline.longest, name).toMatchObject({
          from: row.witness_indexes[0],
          to: row.witness_indexes[1],
          exact: BigInt(row.maximum_gap_microseconds!),
          equalCount: row.equal_max_count,
        });
      }
      // A mark carries every record at one time: the marks with more than one record are the supplied groups of tied times.
      const marks = timeline.strip.kind === "axis" ? timeline.strip.marks : timeline.strip.kind === "one_time" ? [timeline.strip.mark] : [];
      expect(marks.filter((mark) => mark.records.length > 1).length, name).toBe(row.tied_timestamp_group_count);
    }
  });

  it("keeps the records without a usable time off the strip, by their places in the list", () => {
    for (const row of cases) {
      const answer = answerOf(row)!;
      const timeline = suppliedTimeline(answer.records, answer.incident_time);
      const expected = row.rows_in_expected_declared_order.flatMap((record, place) => (record.canonical_key === null ? [place] : []));
      expect(timeline.untimed, `${row.fixture} ${row.case_id}`).toEqual(expected);
    }
  });

  it("draws and computes nothing where the service supplied no diagnostics, or diagnostics of other records", () => {
    const answer = answers.find((item) => item.case_id === "A" && item.incident_time?.timestamp_kind === "utc_instant" && item.incident_time.observed_span_microseconds !== null)!;
    expect(suppliedTimeline(answer.records, undefined)).toMatchObject({ strip: { kind: "not_supplied", reason: "omitted" }, gaps: [], longest: null });
    const others = answer.records.map((record, place) => (place === 0 ? { ...record, row_id: "another" } : record));
    expect(suppliedTimeline(others, answer.incident_time)).toMatchObject({ strip: { kind: "not_supplied", reason: "mismatch" }, gaps: [], longest: null });
    expect(suppliedTimeline(answer.records.slice(1), answer.incident_time).strip).toEqual({ kind: "not_supplied", reason: "mismatch" });
  });
});

describe("the marks of the strip", () => {
  it("places one mark per distinct time linearly between the earliest and the latest, the records of a mark in the order of the list", () => {
    const strip = stripOf([10n, 30n, null, 10n, 20n]);
    if (strip.kind !== "axis") throw new Error("an axis is expected");
    expect(strip.microseconds).toBe(20);
    expect(strip.marks.map((mark) => [mark.time, mark.position, mark.records])).toEqual([
      [10n, 0, [0, 3]],
      [20n, 0.5, [4]],
      [30n, 1, [1]],
    ]);
  });

  it("keeps two times a microsecond apart as two marks in a far year, and has no axis for one time or none", () => {
    const far = 253402300799999999n;
    const strip = stripOf([far - 1n, far]);
    expect(strip.kind === "axis" && strip.marks.length).toBe(2);
    expect(stripOf([5n, 5n]).kind).toBe("one_time");
    expect(stripOf([null, null]).kind).toBe("no_time");
  });
});
