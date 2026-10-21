import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { populationAnswer, preparationId, workspaceId } from "../test/imports";
import { openingContextAnswer } from "../test/views";
import { Filters, rangeStep } from "./Filters";
import { stepWording, unevaluableReason } from "../map/wording";
import { selectionContract } from "../map/client";
import type { SelectionPredicate } from "../generated/selection";

// #89: one control takes a lower and an upper bound of records, span or longest gap and adds one step for the range.
function start() {
  const population = populationAnswer({ schema_version: 1, message_type: "open_population_request", request_id: "fixture-open", query_revision: 1, workspace_id: workspaceId, preparation_id: preparationId });
  const onStep = vi.fn<(step: SelectionPredicate) => void>();
  const opening = openingContextAnswer({ schema_version: 1, message_type: "opening_context_request", request_id: "fixture-context", query_revision: 1, workspace_id: workspaceId, identity: population.identity });
  render(<Filters population={population} parentIds={null} opening={{ phase: "ready", answer: opening }} onStep={onStep} range={null} />);
  return { onStep, user: userEvent.setup() };
}

describe("a range of records, span or longest gap", () => {
  it("adds one step that keeps the range of records, both bounds included, and says so in the control", async () => {
    const { onStep, user } = start();
    await user.click(screen.getByText("A range of records, span or longest gap"));
    expect(screen.getByText(/^Both bounds are included: a case exactly at a bound is in the range\. Every case has a number of records; records without an activity label count\./)).toBeTruthy();
    await user.type(screen.getByLabelText("From, included (records)"), "2");
    await user.type(screen.getByLabelText("To, included (records; empty for no upper bound)"), "4");
    await user.click(screen.getByRole("button", { name: "Keep this range" }));
    expect(onStep).toHaveBeenCalledExactlyOnceWith({ kind: "measure_between", measure: "raw_record_count", minimum: 2, maximum: 4, negate: false });
  });

  it("removes a range of hours of span, and says that a case without the measure is counted apart", async () => {
    const { onStep, user } = start();
    await user.click(screen.getByText("A range of records, span or longest gap"));
    const control = screen.getByText("A range of records, span or longest gap").closest("details")!;
    await user.selectOptions(within(control).getByLabelText("Measure of the range"), "observed_span_hours");
    expect(screen.getByText(/A case whose order is not known has no recorded span: it is not evaluable and is counted apart, neither kept nor removed\./)).toBeTruthy();
    await user.type(screen.getByLabelText("From, included (hours)"), "1.5");
    await user.click(screen.getByRole("button", { name: "Remove this range" }));
    expect(onStep).toHaveBeenCalledExactlyOnceWith({ kind: "measure_between", measure: "observed_span_hours", minimum: 1.5, maximum: null, negate: true });
  });

  it("refuses a range it cannot take, applying nothing", () => {
    expect(rangeStep("raw_record_count", "2.5", "", false)).toBe("Enter the lower bound as a whole number of records, zero or more. Nothing was applied.");
    expect(rangeStep("raw_record_count", "", "4", false)).toBe("Enter the lower bound as a whole number of records, zero or more. Nothing was applied.");
    expect(rangeStep("maximum_adjacent_raw_gap_hours", "5", "2", false)).toBe("The upper bound is below the lower bound. Nothing was applied.");
    expect(rangeStep("maximum_adjacent_raw_gap_hours", "1", "-1", false)).toBe(
      "Enter the upper bound as a finite number of hours, zero or more, or leave it empty for no upper bound. Nothing was applied.");
    expect(rangeStep("maximum_adjacent_raw_gap_hours", "3", "3", false)).toEqual({ kind: "measure_between", measure: "maximum_adjacent_raw_gap_hours", minimum: 3, maximum: 3, negate: false });
  });

  it("words every range and its negation, and why a case is not evaluable for it", () => {
    const step = (measure: "raw_record_count" | "observed_span_hours" | "maximum_adjacent_raw_gap_hours", minimum: number, maximum: number | null, negate = false) =>
      ({ kind: "measure_between", measure, minimum, maximum, negate }) as SelectionPredicate;
    expect([
      stepWording(step("raw_record_count", 2, 4)),
      stepWording(step("raw_record_count", 1, 1)),
      stepWording(step("raw_record_count", 2, 4, true)),
      stepWording(step("observed_span_hours", 2, null)),
      stepWording(step("maximum_adjacent_raw_gap_hours", 0, 5, true)),
      stepWording(step("observed_span_hours", 3, null, true)),
      stepWording(step("observed_span_hours", 2, 10)),
    ]).toEqual([
      "Keep cases with 2 to 4 records, both included",
      "Keep cases with exactly 1 record",
      "Keep cases with fewer than 2 or more than 4 records",
      "Keep cases with recorded span at least 2 hours",
      "Keep cases with longest adjacent recorded gap less than 0 or more than 5 hours",
      "Keep cases with recorded span less than 3 hours",
      "Keep cases with recorded span from 2 to 10 hours, both included",
    ]);
    expect(unevaluableReason(step("raw_record_count", 1, 2))).toBeNull();
    expect(unevaluableReason(step("observed_span_hours", 1, 2))).toBe("the order of their records is not known, so they have no recorded span");
    expect(unevaluableReason(step("maximum_adjacent_raw_gap_hours", 1, 2))).toBe("the order of their records is not known, or they have one record and so no gap");
  });

  it("emits a step the selection contract accepts", () => {
    const population = populationAnswer({ schema_version: 1, message_type: "open_population_request", request_id: "fixture-open", query_revision: 1, workspace_id: workspaceId, preparation_id: preparationId });
    const request = { schema_version: 1, message_type: "select_cases_request", request_id: "fixture-select", query_revision: 1, workspace_id: workspaceId,
      identity: population.identity, parent_case_ids: null, predicates: [{ kind: "measure_between", measure: "raw_record_count", minimum: 2, maximum: null, negate: false }] };
    expect(selectionContract.selectCasesRequest(request)).toBe(true);
    expect(selectionContract.selectCasesRequest({ ...request, predicates: [{ kind: "measure_between", measure: "records", minimum: 2, maximum: null, negate: false }] })).toBe(false);
  });
});
