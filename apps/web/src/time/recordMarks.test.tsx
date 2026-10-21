import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { IncidentMarks as SuppliedMarks, RecordMarksRequest } from "../generated/record-marks";
import { MARKS_BATCH, MarksLoader, RecordMarks } from "./RecordMarks";

const identity = { source_id: "s", preparation_id: "p", representation_id: "r", case_dictionary_id: "c", population_id: "kept", implementation_version: "0.1.0" } as never;

function client(supplied: (caseId: string) => SuppliedMarks) {
  return {
    marks: vi.fn(async (request: RecordMarksRequest) => ({ ok: true as const, answer: { schema_version: 1 as const, message_type: "record_marks_answer" as const,
      request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id, identity: request.identity,
      policy: "incident.records.elapsed_from_first_record.v1" as const, cases: request.case_ids.map(supplied) } })),
  };
}

describe("the records of many incidents on one axis (#67)", () => {
  it("asks for the incidents in view together, in bounded batches, each once", async () => {
    const marks = client((case_id) => ({ case_id, record_count: 1, order_known: true, span_microseconds: 0, marks: [{ offset_microseconds: 0, record_count: 1 }], untimed_record_count: 0 }));
    const loader = new MarksLoader(marks, { workspaceId: "w", revision: 3, identity });
    const ids = Array.from({ length: 150 }, (_, n) => `I-${n}`);
    const loaded = await Promise.all([...ids, ...ids.slice(0, 10)].map((id) => loader.marks(id)));
    expect(marks.marks.mock.calls.map(([request]) => request.case_ids.length)).toEqual([MARKS_BATCH, 50]);
    expect(loaded.every((item) => item.kind === "known")).toBe(true);
  });

  it("writes the count of records at the same time beside their mark, and counts records without a time after the axis", async () => {
    const marks = client((case_id) => ({ case_id, record_count: 5, order_known: false, span_microseconds: 36_000_000_000,
      marks: [{ offset_microseconds: 0, record_count: 3 }, { offset_microseconds: 36_000_000_000, record_count: 1 }], untimed_record_count: 1 }));
    render(<RecordMarks caseId="T-3" loader={new MarksLoader(marks, { workspaceId: "w", revision: 3, identity })} axisHours={20} />);
    const drawn = await screen.findByRole("img");
    expect(drawn.getAttribute("aria-label")).toBe("4 of 5 records over 10 h, from the first record; 3 at the time of the first record; 1 without a usable time");
    expect(Array.from(drawn.querySelectorAll(".record-marks-mark"), (mark) => [mark.getAttribute("x1"), mark.classList.contains("record-marks-tie")])).toEqual([["0.000%", true], ["50.000%", false]]);
    expect(drawn.querySelector(".record-marks-count")?.textContent).toBe("3");
    expect(drawn.querySelector(".record-marks-untimed")?.textContent).toBe("+1 without a time");
  });

  it("says when no record of an incident has a usable time", async () => {
    const marks = client((case_id) => ({ case_id, record_count: 2, order_known: false, span_microseconds: null, marks: [], untimed_record_count: 2 }));
    render(<RecordMarks caseId="T-5" loader={new MarksLoader(marks, { workspaceId: "w", revision: 3, identity })} axisHours={20} />);
    expect((await screen.findByRole("img")).getAttribute("aria-label")).toBe("2 records, none with a usable time; 2 without a usable time");
  });
});
