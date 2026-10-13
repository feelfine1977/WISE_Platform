import { describe, expect, it } from "vitest";
import type { CsvInspectionAnswer, InspectCsvRequest, RoleSuggestion, TimestampFormat } from "../generated/imports";
import { inspectionAnswer } from "../test/imports";
import { proposedRoles, timeFormats } from "./interpretation";

const request = { request_id: "inspection-1", query_revision: 1, workspace_id: "workspace.v1:0123456789abcdef", source_id: `source.v1:sha256:${"5".repeat(64)}` } as InspectCsvRequest;

function column(index: number, filled: number, distinct: number, reads: Partial<Record<TimestampFormat, number>> = {}): RoleSuggestion {
  return {
    column_index: index,
    roles: ["context", "case_id", "activity"],
    nonempty_count: filled,
    distinct_nonempty_count: distinct,
    timestamp_matches: timeFormats.map((format) => ({ format, parsed_count: reads[format] ?? 0 })),
  };
}

function inspected(names: string[], suggestions: RoleSuggestion[], rows: string[][]): CsvInspectionAnswer {
  return {
    ...inspectionAnswer(request),
    columns: names.map((name, index) => ({ index, name })),
    record_count: suggestions[0]?.nonempty_count ?? 0,
    sample_rows: rows.map((cells, source_position) => ({ source_position, cells })),
    role_suggestions: suggestions,
  };
}

describe("what is proposed for a source read for the first time", () => {
  it("proposes the three roles, the format, the zone and the repeating columns of a log exported from an event-log file", () => {
    const answer = inspected(
      ["case:concept:name", "Activity", "concept:name", "time:timestamp", "org:resource", "org:group", "impact", "note"],
      [
        column(0, 65533, 7554),
        column(1, 65533, 13),
        column(2, 65533, 4),
        column(3, 65533, 60023, { iso8601: 65533 }),
        column(4, 65533, 1440),
        column(5, 65533, 649),
        column(6, 65533, 4),
        column(7, 65533, 65000),
      ],
      [
        ["1-364285768", "Accepted / In Progress", "Accepted", "2010-03-31T16:59:42+02:00", "Frederic", "V30", "Medium", "a"],
        ["1-364285768", "Queued / Awaiting Assignment", "Queued", "2010-03-31T17:45:48Z", "Frederic", "V5 3rd", "Medium", "b"],
      ],
    );
    expect(proposedRoles(answer)).toEqual({
      caseColumn: 0,
      // "Activity" is the more telling name beside "concept:name".
      activityColumn: 1,
      timestampColumn: 3,
      timeFormat: "iso8601",
      zone: "from_values",
      // Everything that repeats, also with hundreds of values; the note is different in nearly every record.
      contextColumns: [2, 4, 5, 6],
    });
  });

  it("proposes the roles of a German export by name and leaves the zone open when the times carry none", () => {
    const answer = inspected(
      ["Nummer", "Aktivität", "Zeitstempel", "Gruppe"],
      [column(0, 40, 10), column(1, 40, 6), column(2, 40, 40, { dmy_dot_second: 40 }), column(3, 38, 3)],
      [["INC1", "Eröffnet", "03.04.2026 08:00:00", "Büro"]],
    );
    expect(proposedRoles(answer)).toEqual({
      caseColumn: 0,
      activityColumn: 1,
      timestampColumn: 2,
      timeFormat: "dmy_dot_second",
      zone: null,
      contextColumns: [3],
    });
  });

  it("proposes nothing for a role that two columns could hold", () => {
    const answer = inspected(
      ["ticket", "incident", "status", "event", "opened", "closed"],
      [column(0, 10, 5), column(1, 10, 5), column(2, 10, 3), column(3, 10, 3), column(4, 10, 10, { iso8601: 10 }), column(5, 10, 9, { iso8601: 10 })],
      [["T1", "I1", "open", "created", "2026-10-01 09:00", "2026-10-02 09:00"]],
    );
    const proposed = proposedRoles(answer);
    expect(proposed.caseColumn).toBeNull();
    expect(proposed.activityColumn).toBeNull();
    expect(proposed.timestampColumn).toBeNull();
    expect(proposed.timeFormat).toBeNull();
    expect(proposed.zone).toBeNull();
    // Columns of times are not context, whichever of them becomes the time.
    expect(proposed.contextColumns).toEqual([0, 1, 2, 3]);
  });

  it("proposes the time column but no format when two formats read every value", () => {
    const answer = inspected(
      ["id", "activity", "when"],
      [column(0, 4, 2), column(1, 4, 2), column(2, 4, 4, { dmy_dot_minute: 4, mdy_dot_minute: 4 })],
      [["A", "x", "03.04.2026 08:00"]],
    );
    expect(proposedRoles(answer)).toMatchObject({ caseColumn: 0, activityColumn: 1, timestampColumn: 2, timeFormat: null, zone: null });
  });

  it("does not take a date for an offset", () => {
    const answer = inspected(["id", "activity", "when"], [column(0, 2, 1), column(1, 2, 2), column(2, 2, 2, { iso8601: 2 })], [["A", "x", "2026-10-01"]]);
    expect(proposedRoles(answer).zone).toBeNull();
  });
});
