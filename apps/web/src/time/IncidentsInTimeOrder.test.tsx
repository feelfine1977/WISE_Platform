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

/** The evidence of every incident as the shared fixture A supplies it: three records, at 0, 1 and 5 hours; the first incident's order is not known. */
function evidenceOf(answering: (request: ImportedCaseEvidenceRequest, answer: ImportedCaseEvidenceAnswer) => ImportedCaseEvidenceAnswer = (_, answer) => answer) {
  return {
    caseEvidence: vi.fn(async (request: ImportedCaseEvidenceRequest) => {
      // The fixture's history, answering exactly the question asked.
      const answer = answering(request, {
        ...(fixture as unknown as ImportedCaseEvidenceAnswer),
        request_id: request.request_id,
        query_revision: request.query_revision,
        workspace_id: request.workspace_id,
        identity: request.identity,
        case_id: request.case_id,
      });
      if (request.case_id === "I-000") {
        const { incident_time: _time, ...legacy } = answer;
        void _time;
        return { ok: true as const, answer: { ...legacy, sequence_evaluable: false } as ImportedCaseEvidenceAnswer };
      }
      return { ok: true as const, answer };
    }),
  };
}

function setup(order: "observed_span_hours" | "maximum_adjacent_raw_gap_hours" = "observed_span_hours", evidence = evidenceOf()) {
  const caseLists = ordering();
  const onOpen = vi.fn();
  render(
    <>
      <h3 id="title">Kept incidents</h3>
      <IncidentsInTimeOrder workspaceId="workspace-1" revision={2} identity={kept} kept={keptCases} order={order} openCaseId={null} onOpen={onOpen} focusRequest={null} labelledBy="title" caseLists={caseLists} evidence={evidence} />
    </>,
  );
  return { caseLists, evidence, onOpen, user: userEvent.setup() };
}

describe("the kept incidents in an order by time", () => {
  it("asks the local service for the longest first, a page at a time, and shows both times as columns", async () => {
    const { caseLists } = setup();
    const table = await screen.findByRole("table", { name: "Kept incidents" });
    expect(caseLists.list.mock.calls[0][0].query).toEqual({ search_text: null, sort: { field: "observed_span_hours", direction: "descending" }, offset: 0, limit: PAGE });
    expect(within(table).getAllByRole("columnheader").map((head) => head.textContent)).toEqual(["Incident", "Records", "Mapped records", "Without activity label", "Order of records", "Span", "Longest gap", "Records over time, 0 to 10.4 d"]);
    const first = within(table).getAllByRole("row")[1];
    expect(within(first).getByRole("button").textContent).toBe("I-249");
    expect(within(first).getAllByRole("cell").map((cell) => cell.textContent).slice(4, 6)).toEqual(["10.4 d", "5.2 d"]);
    expect(screen.getByText("200 incidents of 250")).toBeTruthy();
  });

  it("loads the next page under the list, and offers no more after the last one", async () => {
    const { caseLists, user } = setup("maximum_adjacent_raw_gap_hours");
    await user.click(await screen.findByRole("button", { name: "Show 50 more" }));
    expect(caseLists.list.mock.calls[1][0].query).toMatchObject({ sort: { field: "maximum_adjacent_raw_gap_hours", direction: "descending" }, offset: 200 });
    expect(await screen.findByText("250 incidents of 250")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
  });

  it("draws the records of each incident in view as marks on one axis, aligned at its first record, from the supplied offsets", async () => {
    const { evidence } = setup();
    const table = await screen.findByRole("table", { name: "Kept incidents" });
    const first = within(table).getAllByRole("row")[1];
    const marks = await within(first).findByRole("img");
    expect(marks.getAttribute("aria-label")).toBe("3 records over 5 h, from the first record");
    // The axis is the longest span listed, 249 hours: the marks of 0, 1 and 5 hours lie at its very start.
    expect(Array.from(marks.querySelectorAll(".record-marks-mark"), (mark) => Number(mark.getAttribute("x1")).toFixed(2))).toEqual(["0.00", "4.02", "20.08"]);
    expect(evidence.caseEvidence.mock.calls.every(([request]) => request.identity.population_id === "kept")).toBe(true);
    // Only the incidents in view ask for their evidence, each once.
    expect(new Set(evidence.caseEvidence.mock.calls.map(([request]) => request.case_id)).size).toBe(evidence.caseEvidence.mock.calls.length);
  });

  it("draws no marks from an answer to another question, nor from diagnostics that do not belong to the records place by place", async () => {
    const other = evidenceOf((request, answer) =>
      request.case_id === "I-249"
        ? { ...answer, identity: { ...answer.identity, preparation_id: "another-preparation" } }
        : request.case_id === "I-248"
          ? { ...answer, incident_time: { ...answer.incident_time!, records: [answer.incident_time!.records[0], answer.incident_time!.records[2], answer.incident_time!.records[1]] } as typeof answer.incident_time }
          : answer,
    );
    setup("observed_span_hours", other);
    const table = await screen.findByRole("table", { name: "Kept incidents" });
    const [, first, second, third] = within(table).getAllByRole("row");
    expect(await within(first).findByText("not read")).toBeTruthy();
    expect(await within(second).findByText("times do not match")).toBeTruthy();
    expect(await within(third).findByRole("img")).toBeTruthy();
  });
});
