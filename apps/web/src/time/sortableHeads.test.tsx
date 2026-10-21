import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CaseListAnswer, CaseListRequest } from "../generated/case-list";
import type { ImportedCaseSummary } from "../generated/imports";
import type { CaseListOutcome } from "../filters/client";
import { IncidentWindow } from "../imported/IncidentWindow";
import { IncidentsInTimeOrder, type TimeOrder } from "./IncidentsInTimeOrder";
import { kept, parent } from "./testFakes";

// #91: every measure column of the incident list orders it from its head, both ways, and says the direction.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const cases = ["I-1", "I-2"].map((case_id) => ({ case_id, record_count: 2, mapped_record_count: 2, omitted_activity_record_count: 0, sequence_evaluable: true }) as ImportedCaseSummary);

function listing() {
  return {
    list: vi.fn(async (request: CaseListRequest): Promise<CaseListOutcome> => ({
      ok: true,
      answer: {
        request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id, identity: request.identity, parent_identity: parent,
        query: request.query, rows: [], context_columns: [], population_case_count: 2, total_matching_case_count: 0, next_offset: null,
      } as unknown as CaseListAnswer,
    })),
  };
}

const sortOf = (name: string) => screen.getByRole("columnheader", { name }).getAttribute("aria-sort");

describe("ordering the incident list from its column heads", () => {
  it("orders the list by number from the head of Records, by the local service", async () => {
    const onSort = vi.fn();
    render(
      <>
        <h3 id="title">Kept incidents</h3>
        <IncidentWindow cases={cases} openCaseId={null} onOpen={vi.fn()} focusRequest={null} labelledBy="title" sorting={{ column: null, descending: false, onSort }} />
      </>,
    );
    expect(sortOf("Records")).toBeNull();
    // Only the measure columns order: the others keep a plain head.
    expect(within(screen.getByRole("columnheader", { name: "Mapped records" })).queryByRole("button")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Records: sort the list" }));
    expect(onSort).toHaveBeenCalledWith("record_count");
  });

  it("orders by another head in its first direction, reverses on a second click, and says the direction", async () => {
    const caseLists = listing();
    const onOrder = vi.fn();
    const user = userEvent.setup();
    const view = (order: TimeOrder) => (
      <>
        <h3 id="title">Kept incidents</h3>
        <IncidentsInTimeOrder workspaceId="workspace-1" revision={2} identity={kept} kept={cases} order={order} openCaseId={null} onOpen={vi.fn()} focusRequest={null}
          labelledBy="title" caseLists={caseLists} evidence={{ caseEvidence: vi.fn() } as never} onOrder={onOrder} />
      </>
    );
    const { rerender } = render(view("observed_span_hours"));
    await screen.findByRole("table", { name: "Kept incidents" });
    expect([sortOf("Span"), sortOf("Longest gap"), sortOf("Records"), sortOf("First record")]).toEqual(["descending", null, null, null]);
    await user.click(screen.getByRole("button", { name: "Span: sort the list" }));
    expect(caseLists.list.mock.calls.at(-1)![0].query).toMatchObject({ sort: { field: "observed_span_hours", direction: "ascending" }, offset: 0 });
    expect(await screen.findByText(/^By recorded span, the shortest first; equal values in the order of their numbers, and incidents without a value last\./)).toBeTruthy();
    expect(sortOf("Span")).toBe("ascending");
    await user.click(screen.getByRole("button", { name: "First record: sort the list" }));
    expect(onOrder).toHaveBeenCalledWith("first_recorded_time");
    rerender(view("first_recorded_time"));
    await screen.findByText(/^By time of the first record, the earliest first/);
    expect(caseLists.list.mock.calls.at(-1)![0].query.sort).toEqual({ field: "first_recorded_time", direction: "ascending" });
    expect([sortOf("Span"), sortOf("First record")]).toEqual([null, "ascending"]);
    await user.click(screen.getByRole("button", { name: "First record: sort the list" }));
    expect(caseLists.list.mock.calls.at(-1)![0].query.sort).toEqual({ field: "first_recorded_time", direction: "descending" });
    expect(sortOf("First record")).toBe("descending");
    await user.click(screen.getByRole("button", { name: "Longest gap: sort the list" }));
    await user.click(screen.getByRole("button", { name: "Records: sort the list" }));
    expect(onOrder.mock.calls.map(([order]) => order)).toEqual(["first_recorded_time", "maximum_adjacent_raw_gap_hours", "record_count"]);
  });
});
