import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { numericDeclaration } from "../data/interpretation";
import type { ImportedPopulationAnswer } from "../generated/imports";
import type { NumericContextAnswer, NumericContextRequest } from "../generated/numeric-context";
import type { SelectionPredicate } from "../generated/selection";
import { stepWording, shortStepWording, unevaluableReason } from "../map/wording";
import { populationAnswer, preparationId, workspaceId } from "../test/imports";
import { numbersContract } from "./client";
import { NumberRange, numberStep, numberText } from "./NumberRange";

// #85: numbers in a context column declared numeric: the declaration, the reading, the range and its distribution.
const base = populationAnswer({ schema_version: 1, message_type: "open_population_request", request_id: "o", query_revision: 1, workspace_id: workspaceId, preparation_id: preparationId });
const declared = (numeric: { column_index: number; unit: string | null }[] | undefined) =>
  ({ ...base, preparation: { ...base.preparation, mapping: { ...base.preparation.mapping, context_columns: [5, 6],
    ...(numeric ? { numeric_context_columns: numeric } : {}) } } }) as ImportedPopulationAnswer;

function answering(request: NumericContextRequest): NumericContextAnswer {
  const support = (count: number, measured: number) => ({ case_count: count, measured_case_count: measured,
    unavailable: [{ reason: "order_unknown" as const, case_count: 1 }, { reason: "missing" as const, case_count: 1 }, { reason: "not_a_number" as const, case_count: count - measured - 2 }],
    records: { number_record_count: 10, missing_record_count: 2, not_a_number_record_count: 2 } });
  return {
    schema_version: 1, message_type: "numeric_context_answer", request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id,
    identity: request.identity, parent_identity: request.identity, number_policy: "incident.context.number.point_or_comma_decimal.v1",
    binning_policy: "incident.context.number.equal_width_parent_range.v1", column_index: request.column_index, column_name: "Confidence", unit: null,
    projection: request.projection, parent_range: { minimum: 0.75, maximum: 0.9 },
    bins: [{ start_inclusive: 0.75, end_exclusive: 0.825, parent_case_count: 2, kept_case_count: 1 }, { start_inclusive: 0.825, end_exclusive: null, parent_case_count: 2, kept_case_count: 2 }],
    membership_overlaps: request.projection === "any_record", parent: support(7, 4), kept: support(6, 3),
  };
}

function start(numeric: { column_index: number; unit: string | null }[] | undefined = [{ column_index: 5, unit: null }, { column_index: 6, unit: "EUR" }], previewed = false) {
  const client = { numbers: vi.fn(async (request: NumericContextRequest) => ({ ok: true as const, answer: answering(request) })) };
  const onStep = vi.fn<(step: SelectionPredicate) => void>();
  const previewStep = vi.fn(async () => ({ ok: true as const, kept: 3, removed: 1, unevaluable: 3, parent: 7 }));
  render(<NumberRange population={declared(numeric)} identity={base.identity} revision={3} columnName={(index) => (index === 5 ? "Confidence" : index === 6 ? "Amount" : `Column ${index}`)}
    onStep={onStep} previewStep={previewed ? (previewStep as never) : undefined} client={client} />);
  return { client, onStep, user: userEvent.setup() };
}

describe("the numbers of a context column", () => {
  it("reads a bound with a point or a comma and refuses what is no half-open range", () => {
    expect(numberStep(5, "first_record", "0,8", "", false)).toEqual({ kind: "context_number_in_range", column_index: 5, projection: "first_record", minimum: 0.8, maximum: null, negate: false });
    expect(numberStep(6, "any_record", "-5", "100.5", true)).toEqual({ kind: "context_number_in_range", column_index: 6, projection: "any_record", minimum: -5, maximum: 100.5, negate: true });
    expect(numberStep(5, "first_record", "high", "", false)).toBe("Enter each bound as a number, with a decimal point or comma. Nothing was applied.");
    expect(numberStep(5, "first_record", "1e3", "", false)).toBe("Enter each bound as a number, with a decimal point or comma. Nothing was applied.");
    expect(numberStep(5, "first_record", "", "", false)).toBe("Enter at least one bound. Nothing was applied.");
    expect(numberStep(5, "first_record", "0.8", "0.8", false)).toBe("The upper bound must be above the lower bound: the lower one is included, the upper one is not. Nothing was applied.");
    expect(numberText(0.8250000001)).toBe("0.825");
  });

  it("declares numeric only the chosen context columns, with a unit or none, and nothing when none is chosen", () => {
    expect(numericDeclaration({ contextColumns: [6, 5], numericColumns: [{ column: 6, unit: " EUR " }, { column: 5, unit: "" }, { column: 9, unit: "kg" }] })).toEqual({
      numeric_context_columns: [{ column_index: 5, unit: null }, { column_index: 6, unit: "EUR" }] });
    expect(numericDeclaration({ contextColumns: [5], numericColumns: [] })).toEqual({});
  });

  it("asks for the parent's bins of the chosen column and projection, and says the range, the overlaps and what has no number", async () => {
    const { client, user } = start();
    expect(await screen.findByText("Range in the parent: 0.75 to 0.9; 3 kept incidents of 6 have a number.")).toBeTruthy();
    expect(client.numbers.mock.calls[0][0]).toMatchObject({ column_index: 5, projection: "first_record", bin_count: 10, query_revision: 3 });
    expect(screen.getByRole("group", { name: "Incidents by Confidence at the first record" })).toBeTruthy();
    expect(screen.getByText(/^Without a number here: 1 kept incident \(order not known\), 1 kept incident \(no value\), 1 kept incident \(not a number\)/)).toBeTruthy();
    expect(screen.getByText(/^2 records of the parent hold text that is not a number in this column; it stays as written and is never read as zero\./)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Read at"), "any_record");
    expect(client.numbers.mock.calls.at(-1)![0].projection).toBe("any_record");
    expect(await screen.findByText(/bins overlap/)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Column"), "6");
    expect(client.numbers.mock.calls.at(-1)![0].column_index).toBe(6);
    expect(screen.getByLabelText("From, included (EUR)")).toBeTruthy();
  });

  it("keeps and removes by typed bounds, the lower included and the upper not, previewing the step first", async () => {
    const { onStep, user } = start(undefined, true);
    await screen.findByText(/^Range in the parent/);
    await user.type(screen.getByLabelText("From, included"), "0,8");
    await user.click(screen.getByRole("button", { name: "Keep this range of numbers" }));
    const pending = screen.getByRole("group", { name: "Number step not yet taken" });
    expect(within(pending).getByText("Keep incidents whose number in column 5 (its name is not known) at the first record is at least 0.8")).toBeTruthy();
    expect(await within(pending).findByText(/^Preview: would keep 3 incidents of 7 incidents; 1 removed, 3 not evaluable\./)).toBeTruthy();
    await user.click(within(pending).getByRole("button", { name: "Take this step" }));
    expect(onStep).toHaveBeenCalledExactlyOnceWith({ kind: "context_number_in_range", column_index: 5, projection: "first_record", minimum: 0.8, maximum: null, negate: false });
  });

  it("takes the bounds of the bins chosen on the chart, the exact edges the parent fixed", async () => {
    const { onStep, user } = start();
    await screen.findByText(/^Range in the parent/);
    const chart = screen.getByRole("group", { name: "Incidents by Confidence at the first record" });
    chart.focus();
    await user.keyboard("{Home}{Enter}");
    expect(onStep).toHaveBeenCalledWith({ kind: "context_number_in_range", column_index: 5, projection: "first_record", minimum: 0.75, maximum: 0.825, negate: false });
  });

  it("says when no column was declared a number", async () => {
    start([]);
    expect(screen.getByText("No context column was declared a number. Declare one in Data, with its unit, to keep incidents by a range of its numbers.")).toBeTruthy();
  });

  it("words the step, its chip and why an incident is not evaluable, and the contract takes it", () => {
    const step = (projection: "first_record" | "latest_record" | "any_record", minimum: number | null, maximum: number | null, negate = false) =>
      ({ kind: "context_number_in_range", column_index: 5, projection, minimum, maximum, negate }) as SelectionPredicate;
    expect([stepWording(step("latest_record", 0.7, 0.9)), stepWording(step("any_record", null, 10, true)), shortStepWording(step("latest_record", 0.7, 0.9))]).toEqual([
      "Keep incidents whose number in column 5 (its name is not known) at the latest record with a value is from 0.7 up to, not including, 0.9",
      "Keep incidents whose number in column 5 (its name is not known) at any record is not below 10",
      "column 5 (latest) 0.7–<0.9",
    ]);
    expect(unevaluableReason(step("first_record", 1, null))).toBe("their order is not known, or the value there is empty or not a number");
    expect(unevaluableReason(step("any_record", 1, null))).toBe("no record holds a number in this column: the cells are empty or not numbers");
    expect(numbersContract.request({ schema_version: 1, message_type: "numeric_context_request", request_id: "r", query_revision: 1, workspace_id: workspaceId,
      identity: base.identity, column_index: 5, projection: "latest_record", bin_count: 10 })).toBe(true);
  });
});
