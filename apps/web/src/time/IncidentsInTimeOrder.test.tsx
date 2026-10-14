import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CaseListAnswer, CaseListRequest, ExplorerCaseSummary } from "../generated/case-list";
import type { ImportedCaseSummary } from "../generated/imports";
import type { CaseListOutcome } from "../filters/client";
import { IncidentsInTimeOrder, PAGE } from "./IncidentsInTimeOrder";
import { kept, parent } from "./testFakes";

// The table measures its container; the test page has no layout, so nothing is ever resized.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const ids = Array.from({ length: 250 }, (_, place) => `I-${String(place).padStart(3, "0")}`);
const keptCases: ImportedCaseSummary[] = ids.map((case_id) => ({ case_id, record_count: 3, mapped_record_count: 3, omitted_activity_record_count: 0, sequence_evaluable: true }) as ImportedCaseSummary);

/** A case list that orders the incidents by their place, the last the longest, and has no time for the first one. */
function ordering() {
  return {
    list: vi.fn(async (request: CaseListRequest): Promise<CaseListOutcome> => {
      const longestFirst = [...ids].reverse();
      const page = longestFirst.slice(request.query.offset, request.query.offset + request.query.limit);
      const rows = page.map((case_id) => {
        const hours = ids.indexOf(case_id);
        const time_summary = hours === 0
          ? { status: "unavailable", reason: "order_unknown" }
          : { status: "available", timestamp_kind: "utc_instant", observed_span_hours: hours, maximum_adjacent_raw_gap_hours: hours / 2 };
        return { case_id, record_count: 3, mapped_record_count: 3, omitted_activity_record_count: 0, sequence_evaluable: hours !== 0, time_summary, maximum_gap_context: null } as unknown as ExplorerCaseSummary;
      });
      const next = request.query.offset + rows.length;
      const answer = {
        request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id, identity: request.identity,
        parent_identity: parent, query: request.query, rows, total_matching_case_count: ids.length, next_offset: next < ids.length ? next : null,
      } as unknown as CaseListAnswer;
      return { ok: true, answer };
    }),
  };
}

function setup(order: "observed_span_hours" | "maximum_adjacent_raw_gap_hours" = "observed_span_hours") {
  const caseLists = ordering();
  const onOpen = vi.fn();
  render(
    <>
      <h3 id="title">Kept incidents</h3>
      <IncidentsInTimeOrder workspaceId="workspace-1" revision={2} identity={kept} kept={keptCases} order={order} openCaseId={null} onOpen={onOpen} focusRequest={null} labelledBy="title" caseLists={caseLists} />
    </>,
  );
  return { caseLists, onOpen, user: userEvent.setup() };
}

describe("the kept incidents in an order by time", () => {
  it("asks the local service for the longest first, a page at a time, and shows both times as columns", async () => {
    const { caseLists } = setup();
    const table = await screen.findByRole("table", { name: "Kept incidents" });
    expect(caseLists.list.mock.calls[0][0].query).toEqual({ search_text: null, sort: { field: "observed_span_hours", direction: "descending" }, offset: 0, limit: PAGE });
    expect(within(table).getAllByRole("columnheader").map((head) => head.textContent)).toEqual(["Incident", "Records", "Mapped records", "Without activity label", "Order of records", "Span", "Longest gap"]);
    const first = within(table).getAllByRole("row")[1];
    expect(within(first).getByRole("button").textContent).toBe("I-249");
    expect(within(first).getAllByRole("cell").map((cell) => cell.textContent).slice(-2)).toEqual(["10.4 d", "5.2 d"]);
    expect(screen.getByText("200 incidents of 250")).toBeTruthy();
  });

  it("loads the next page under the list, and offers no more after the last one", async () => {
    const { caseLists, user } = setup("maximum_adjacent_raw_gap_hours");
    await user.click(await screen.findByRole("button", { name: "Show 50 more" }));
    expect(caseLists.list.mock.calls[1][0].query).toMatchObject({ sort: { field: "maximum_adjacent_raw_gap_hours", direction: "descending" }, offset: 200 });
    expect(await screen.findByText("250 incidents of 250")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
  });
});
