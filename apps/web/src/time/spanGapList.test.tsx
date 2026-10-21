import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CaseListAnswer, CaseListRequest, ExplorerCaseSummary } from "../generated/case-list";
import type { ImportedCaseSummary } from "../generated/imports";
import type { CaseListOutcome } from "../filters/client";
import { IncidentsInTimeOrder, type TimeOrder } from "./IncidentsInTimeOrder";
import { kept, parent } from "./testFakes";

// #58: the rows of the ordered list, what it says of the incident in focus, its orders either way round, and its search.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const DESK = 4;
const AGENT = 5;

function available(first: string, last: string, firstActivity: string | null, lastActivity: string | null, span: number, gap: number | null,
  witness: ExplorerCaseSummary["time_summary"]["maximum_gap_witness"], tied = 0) {
  return {
    status: "available", timestamp_kind: "utc_instant", first_recorded_timestamp: first, last_recorded_timestamp: last,
    first_recorded_activity: firstActivity, last_recorded_activity: lastActivity, observed_span_hours: span, observed_span_unavailable_reason: null,
    maximum_adjacent_raw_gap_hours: gap, maximum_adjacent_raw_gap_unavailable_reason: gap === null ? "fewer_than_two_records" : null,
    maximum_gap_witness: witness, usable_gap_count: gap === null ? 0 : 1, tied_timestamp_group_count: tied,
  } as ExplorerCaseSummary["time_summary"];
}

const context = (desk: string | null, agent: string | null) => [{ column_index: DESK, value: desk }, { column_index: AGENT, value: agent }];

/** The incidents of tests/fixtures/span-gap as the service lists them, the longest span first. */
const ROWS: ExplorerCaseSummary[] = [
  { case_id: "S-UNLAB", record_count: 3, mapped_record_count: 2, omitted_activity_record_count: 1, sequence_evaluable: true,
    time_summary: available("2026-05-04T08:00:00Z", "2026-05-04T15:00:00Z", "Opened", "Resolved", 7, 6,
      { from_row_id: "row-unlab-2", to_row_id: "row-unlab-3", from_activity: null, to_activity: "Resolved", from_offset_hours: 1, share_of_observed_span: 6 / 7, share_unavailable_reason: null }),
    maximum_gap_context: { from_context: context("North", null), to_context: context("West", "Cy") } },
  { case_id: "S-TIE", record_count: 3, mapped_record_count: 3, omitted_activity_record_count: 0, sequence_evaluable: true,
    time_summary: available("2026-05-02T08:00:00Z", "2026-05-02T10:00:00Z", "Opened", "Resolved", 2, 2,
      { from_row_id: "row-tie-2", to_row_id: "row-tie-3", from_activity: "Assigned", to_activity: "Resolved", from_offset_hours: 0, share_of_observed_span: 1, share_unavailable_reason: null }, 1),
    maximum_gap_context: { from_context: context("West", "Ben"), to_context: context("West", "Cy") } },
  { case_id: "S-ALLTIE", record_count: 2, mapped_record_count: 2, omitted_activity_record_count: 0, sequence_evaluable: true,
    time_summary: available("2026-05-03T08:00:00Z", "2026-05-03T08:00:00Z", "Opened", "Resolved", 0, 0,
      { from_row_id: "row-alltie-1", to_row_id: "row-alltie-2", from_activity: "Opened", to_activity: "Resolved", from_offset_hours: 0, share_of_observed_span: null, share_unavailable_reason: "zero_observed_span" }, 1),
    maximum_gap_context: { from_context: context("East", "Ann"), to_context: context("East", "Ann") } },
  { case_id: "S-ONE", record_count: 1, mapped_record_count: 1, omitted_activity_record_count: 0, sequence_evaluable: true,
    time_summary: available("2026-05-01T08:00:00Z", "2026-05-01T08:00:00Z", "Opened", "Opened", 0, null, null), maximum_gap_context: null },
  { case_id: "S-UNK", record_count: 2, mapped_record_count: 2, omitted_activity_record_count: 0, sequence_evaluable: false,
    time_summary: { status: "unavailable", reason: "order_unknown", unavailable_timestamp_record_count: 1, first_recorded_timestamp: null, last_recorded_timestamp: null,
      first_recorded_activity: null, last_recorded_activity: null, observed_span_hours: null, observed_span_unavailable_reason: "order_unknown",
      maximum_adjacent_raw_gap_hours: null, maximum_adjacent_raw_gap_unavailable_reason: "order_unknown", maximum_gap_witness: null, usable_gap_count: 0, tied_timestamp_group_count: null },
    maximum_gap_context: null },
];
const keptCases = ROWS.map(({ case_id, record_count, mapped_record_count, omitted_activity_record_count, sequence_evaluable }) =>
  ({ case_id, record_count, mapped_record_count, omitted_activity_record_count, sequence_evaluable }) as ImportedCaseSummary);

function listing(columns = [{ column_index: DESK, name: "Desk" }, { column_index: AGENT, name: "Agent" }]) {
  return {
    list: vi.fn(async (request: CaseListRequest): Promise<CaseListOutcome> => {
      const search = request.query.search_text;
      const rows = search === null ? ROWS : ROWS.filter((row) => row.case_id.includes(search));
      const answer = {
        request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id, identity: request.identity,
        parent_identity: parent, query: request.query, rows, context_columns: columns, population_case_count: ROWS.length,
        total_matching_case_count: rows.length, next_offset: null,
      } as unknown as CaseListAnswer;
      return { ok: true, answer };
    }),
  };
}

const noMarks = { marks: vi.fn(async () => ({ ok: false as const, problem: { kind: "unreachable" as const } })) };

function setup(order: TimeOrder = "observed_span_hours", caseLists = listing()) {
  const onShowRecords = vi.fn();
  render(
    <>
      <h3 id="title">Kept cases</h3>
      <IncidentsInTimeOrder workspaceId="workspace-1" revision={2} identity={kept} kept={keptCases} order={order} openCaseId={null} onOpen={vi.fn()}
        focusRequest={null} labelledBy="title" caseLists={caseLists} marks={noMarks} onShowRecords={onShowRecords} />
    </>,
  );
  return { caseLists, onShowRecords, user: userEvent.setup() };
}

const focus = () => screen.getByRole("region", { name: /^S-/ });

describe("the list of kept cases by span and longest gap", () => {
  it("says of the case in focus its first and last records, its span, and its longest gap with its two activities, offset and share", async () => {
    const { onShowRecords, user } = setup();
    await screen.findByRole("table", { name: "Kept cases" });
    expect(within(focus()).getByRole("heading").textContent).toBe("S-UNLAB: 3 records, 1 without activity label");
    expect(focus().textContent).toContain("First record 2026-05-04 08:00:00 UTC, “Opened”; last record 2026-05-04 15:00:00 UTC, “Resolved”.");
    expect(focus().textContent).toContain("Recorded span 7 h.");
    // The record without an activity label bounds the gap and is named, never left out.
    expect(focus().textContent).toContain("Longest gap 6 h, from a record without activity label to “Resolved”, beginning 1 h after the first record; 86% of the span.");
    await user.click(within(focus()).getByRole("button", { name: "Show the two records of the gap" }));
    expect(onShowRecords).toHaveBeenCalledWith("S-UNLAB", ["row-unlab-2", "row-unlab-3"]);
  });

  it("shows the context of the two records of the gap from the chosen context columns only, an empty value as not recorded", async () => {
    setup();
    await screen.findByRole("table", { name: "Kept cases" });
    const table = within(focus()).getByRole("table", { name: /^Context at the two records of the longest gap/ });
    expect(within(table).getAllByRole("row").map((row) => Array.from(row.children, (cell) => cell.textContent))).toEqual([
      ["Context column", "Where the gap begins", "Where it ends"],
      ["Desk", "North", "West"],
      ["Agent", "not recorded", "Cy"],
    ]);
    // There is no sender or recipient of its own.
    expect(screen.queryByText(/sender|recipient/i)).toBeNull();
  });

  it("says that there is no context when no context column was chosen", async () => {
    setup("observed_span_hours", listing([]));
    await screen.findByRole("table", { name: "Kept cases" });
    expect(within(focus()).getByText("No context column was chosen for this source, so the gap has no context to show.")).toBeTruthy();
  });

  it("follows the current row: tied times are zero gaps, one record spans zero without a gap, and an unknown order has neither", async () => {
    const { user } = setup();
    const table = await screen.findByRole("table", { name: "Kept cases" });
    await user.click(within(table).getByRole("button", { name: "S-UNLAB" }));
    await user.keyboard("{ArrowDown}");
    expect(focus().textContent).toContain("One group of records shares a time; the gaps within it are zero.");
    await user.keyboard("{ArrowDown}");
    expect(focus().textContent).toContain("Longest gap 0 min, from “Opened” to “Resolved”, beginning 0 min after the first record; no share: the span is zero.");
    await user.keyboard("{ArrowDown}");
    expect(focus().textContent).toContain("Recorded span 0 min: one record spans zero.");
    expect(focus().textContent).toContain("No longest gap: one record has no gap.");
    expect(within(focus()).queryByRole("button")).toBeNull();
    await user.keyboard("{ArrowDown}");
    expect(focus().textContent).toContain("The order of its records is not fully known (1 record has no usable time): it has no span and no longest gap, and stands last in every order by time.");
    // The cells of the incident without a value are dashes.
    const last = within(table).getAllByRole("row")[5];
    expect(within(last).getAllByRole("cell").slice(4, 8).map((cell) => cell.textContent)).toEqual(["–", "–", "–", "–"]);
  });

  it("asks for each order in its first direction, says it in words, and reverses it on request from the first page", async () => {
    const { caseLists, user } = setup("record_count");
    await screen.findByRole("table", { name: "Kept cases" });
    expect(caseLists.list.mock.calls.at(-1)![0].query.sort).toEqual({ field: "record_count", direction: "descending" });
    expect(screen.getByText("By number of records, the most first; equal values in the order of their numbers, and cases without a value last.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reverse" }));
    expect(caseLists.list.mock.calls.at(-1)![0].query).toMatchObject({ sort: { field: "record_count", direction: "ascending" }, offset: 0 });
    expect(screen.getByRole("button", { name: "Reverse" }).getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText(/^By number of records, the fewest first/)).toBeTruthy();
  });

  it("orders by first record the earliest first", async () => {
    const { caseLists } = setup("first_recorded_time");
    await screen.findByRole("table", { name: "Kept cases" });
    expect(caseLists.list.mock.calls.at(-1)![0].query.sort).toEqual({ field: "first_recorded_time", direction: "ascending" });
    expect(screen.getByText(/^By time of the first record, the earliest first/)).toBeTruthy();
  });

  it("finds cases by number in the same order, narrowing only the rows shown, and shows every kept case again", async () => {
    const { caseLists, user } = setup();
    await screen.findByRole("table", { name: "Kept cases" });
    await user.type(screen.getByRole("searchbox", { name: "Case number contains" }), "TIE");
    await user.click(screen.getByRole("button", { name: "Find" }));
    expect(caseLists.list.mock.calls.at(-1)![0].query).toMatchObject({ search_text: "TIE", sort: { field: "observed_span_hours", direction: "descending" }, offset: 0 });
    const said = await screen.findByRole("status");
    expect(said.textContent).toBe("2 kept cases of 5 have “TIE” in their numbers. The search narrows only the rows shown: the kept cases, their counts and their distribution stay the same.");
    const table = screen.getByRole("table", { name: "Kept cases" });
    expect(within(table).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("button")[0].textContent)).toEqual(["S-TIE", "S-ALLTIE"]);
    await user.click(screen.getByRole("button", { name: "Show every kept case" }));
    expect(caseLists.list.mock.calls.at(-1)![0].query.search_text).toBeNull();
    expect(await screen.findByText("5 cases of 5")).toBeTruthy();
  });

  it("says when no kept case has the text in its number", async () => {
    const { user } = setup();
    await screen.findByRole("table", { name: "Kept cases" });
    await user.type(screen.getByRole("searchbox", { name: "Case number contains" }), "nothing{Enter}");
    expect((await screen.findByRole("status")).textContent).toMatch(/^No kept case has “nothing” in its number\./);
  });
});
