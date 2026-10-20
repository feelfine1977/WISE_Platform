import type { RecordMarksRequest } from "../generated/record-marks";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CaseListAnswer, CaseListRequest, ExplorerCaseSummary } from "../generated/case-list";
import type { ImportedCaseSummary } from "../generated/imports";
import type { CaseListOutcome } from "../filters/client";
import fixture from "../../../../tests/fixtures/incident-time/positive/utc_instant-A.json";
import type { ImportedCaseEvidenceAnswer, ImportedCaseEvidenceRequest } from "../generated/imports";
import { IncidentsInTimeOrder, PAGE } from "./IncidentsInTimeOrder";
import { kept, parent } from "./testFakes";

// The table measures its container; the test page has no layout, so nothing is ever resized.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const ids = Array.from({ length: 250 }, (_, place) => `I-${String(place).padStart(3, "0")}`);
const keptCases: ImportedCaseSummary[] = ids.map((case_id) => ({ case_id, record_count: 3, mapped_record_count: 3, omitted_activity_record_count: 0, sequence_evaluable: true }) as ImportedCaseSummary);

/** A case list that orders the incidents by their place, the last the longest, and has no time for the first one. */
function ordering(clock: "utc_instant" | "wall_clock" = "utc_instant") {
  return {
    list: vi.fn(async (request: CaseListRequest): Promise<CaseListOutcome> => {
      const longestFirst = [...ids].reverse();
      const page = longestFirst.slice(request.query.offset, request.query.offset + request.query.limit);
      const rows = page.map((case_id) => {
        const hours = ids.indexOf(case_id);
        const time_summary = hours === 0
          ? { status: "unavailable", reason: "order_unknown" }
          : {
              status: "available", timestamp_kind: clock, observed_span_hours: hours, maximum_adjacent_raw_gap_hours: hours / 2,
              first_recorded_timestamp: clock === "utc_instant" ? "2026-01-01T08:00:00Z" : "2026-01-01T08:00:00", last_recorded_timestamp: clock === "utc_instant" ? "2026-01-11T08:00:00Z" : "2026-01-11T08:00:00",
              first_recorded_activity: "Opened", last_recorded_activity: "Resolved", observed_span_unavailable_reason: null, maximum_adjacent_raw_gap_unavailable_reason: null,
              maximum_gap_witness: { from_row_id: `${case_id}-r2`, to_row_id: `${case_id}-r3`, from_activity: "Assigned", to_activity: null, from_offset_hours: 1, share_of_observed_span: 0.5, share_unavailable_reason: null },
              usable_gap_count: 2, tied_timestamp_group_count: 0,
            };
        return { case_id, record_count: 3, mapped_record_count: 3, omitted_activity_record_count: 0, sequence_evaluable: hours !== 0, time_summary, maximum_gap_context: null } as unknown as ExplorerCaseSummary;
      });
      const next = request.query.offset + rows.length;
      const answer = {
        request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id, identity: request.identity,
        parent_identity: parent, query: request.query, rows, context_columns: [], population_case_count: ids.length, total_matching_case_count: ids.length, next_offset: next < ids.length ? next : null,
      } as unknown as CaseListAnswer;
      return { ok: true, answer };
    }),
  };
}

/** The marks of every incident: three records, at 0, 1 and 5 hours; a batch whose answer cannot be used when `failing`. */
function marksOf(failing = false) {
  return {
    marks: vi.fn(async (request: RecordMarksRequest) => failing
      ? { ok: false as const, problem: { kind: "unreachable" as const } }
      : { ok: true as const, answer: { schema_version: 1 as const, message_type: "record_marks_answer" as const, request_id: request.request_id, query_revision: request.query_revision,
          workspace_id: request.workspace_id, identity: request.identity, policy: "incident.records.elapsed_from_first_record.v1" as const,
          cases: request.case_ids.map((case_id) => ({ case_id, record_count: 3, order_known: true, span_microseconds: 18_000_000_000,
            marks: [{ offset_microseconds: 0, record_count: 1 }, { offset_microseconds: 3_600_000_000, record_count: 1 }, { offset_microseconds: 18_000_000_000, record_count: 1 }],
            untimed_record_count: 0 })) } }),
  };
}

function setup(order: "observed_span_hours" | "maximum_adjacent_raw_gap_hours" = "observed_span_hours", marks = marksOf(), clock: "utc_instant" | "wall_clock" = "utc_instant") {
  const caseLists = ordering(clock);
  const onOpen = vi.fn();
  render(
    <>
      <h3 id="title">Kept incidents</h3>
      <IncidentsInTimeOrder workspaceId="workspace-1" revision={2} identity={kept} kept={keptCases} order={order} openCaseId={null} onOpen={onOpen} focusRequest={null} labelledBy="title" caseLists={caseLists} marks={marks} />
    </>,
  );
  return { caseLists, marks, onOpen, user: userEvent.setup() };
}

describe("the kept incidents in an order by time", () => {
  it("asks the local service for the longest first, a page at a time, and shows both times as columns", async () => {
    const { caseLists } = setup();
    const table = await screen.findByRole("table", { name: "Kept incidents" });
    expect(caseLists.list.mock.calls[0][0].query).toEqual({ search_text: null, sort: { field: "observed_span_hours", direction: "descending" }, offset: 0, limit: PAGE });
    expect(within(table).getAllByRole("columnheader").map((head) => head.textContent)).toEqual(["Incident", "Records", "Mapped records", "Records without activity label", "Order of records", "Span▼", "Longest gap", "First record", "Longest gap between", "Records over time, 0 to 10.4 d"]);
    const first = within(table).getAllByRole("row")[1];
    expect(within(first).getByRole("button").textContent).toBe("I-249");
    expect(within(first).getAllByRole("cell").map((cell) => cell.textContent).slice(4, 8)).toEqual(["10.4 d", "5.2 d", "2026-01-01 08:00:00 UTC", "Assigned → no activity label"]);
    expect(screen.getByText("200 incidents of 250")).toBeTruthy();
  });

  it("says under the table that wall-clock spans and gaps may differ from the physical elapsed time", async () => {
    setup("observed_span_hours", marksOf(), "wall_clock");
    await screen.findByRole("table", { name: "Kept incidents" });
    expect(screen.getByText(/^Wall clock: span and longest gap are differences between times as recorded/)).toBeTruthy();
  });

  it("shows no wall-clock note for instants", async () => {
    setup();
    await screen.findByRole("table", { name: "Kept incidents" });
    expect(screen.queryByText(/^Wall clock: span and longest gap/)).toBeNull();
  });

  it("loads the next page under the list, and offers no more after the last one", async () => {
    const { caseLists, user } = setup("maximum_adjacent_raw_gap_hours");
    await user.click(await screen.findByRole("button", { name: "Show 50 more" }));
    expect(caseLists.list.mock.calls[1][0].query).toMatchObject({ sort: { field: "maximum_adjacent_raw_gap_hours", direction: "descending" }, offset: 200 });
    expect(await screen.findByText("250 incidents of 250")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
  });

  it("draws the records of each incident in view as marks on one axis, aligned at its first record, from bounded batches of marks (#67)", async () => {
    const { marks: client } = setup();
    const table = await screen.findByRole("table", { name: "Kept incidents" });
    const first = within(table).getAllByRole("row")[1];
    const marks = await within(first).findByRole("img");
    expect(marks.getAttribute("aria-label")).toBe("3 records over 5 h, from the first record; the longest gap, 5.2 d, marked from 1 h");
    // The longest gap is a band from 1 hour to 1 + 124.5 hours on the axis of 249 hours.
    const band = marks.querySelector(".record-marks-gap")!;
    expect([band.getAttribute("x"), band.getAttribute("width")]).toEqual(["0.402%", "50.000%"]);
    // The axis is the longest span listed, 249 hours: the marks of 0, 1 and 5 hours lie at its very start.
    expect(Array.from(marks.querySelectorAll(".record-marks-mark"), (mark) => mark.getAttribute("x1"))).toEqual(["0.000%", "0.402%", "2.008%"]);
    // The incidents in view ask together, at most 100 at once, each once, for the incidents shown.
    const asked = client.marks.mock.calls.flatMap(([request]) => request.case_ids);
    expect(client.marks.mock.calls.every(([request]) => request.case_ids.length <= 100 && request.identity.population_id === "kept")).toBe(true);
    expect(new Set(asked).size).toBe(asked.length);
  });

  it("says that the marks were not read where a batch fails", async () => {
    setup("observed_span_hours", marksOf(true));
    const table = await screen.findByRole("table", { name: "Kept incidents" });
    expect(await within(within(table).getAllByRole("row")[1]).findByText("not read")).toBeTruthy();
  });
});
