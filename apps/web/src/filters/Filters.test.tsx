import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { populationAnswer, preparationId, workspaceId } from "../test/imports";
import { openingContextAnswer } from "../test/views";
import { Filters, type RecordedRange } from "./Filters";
import { stepWording } from "../map/wording";
import { selectionContract } from "../map/client";
import type { SelectionPredicate } from "../generated/selection";

const range: RecordedRange = { timestamp_kind: "utc_instant", earliest_recorded_timestamp: "2026-04-01T00:00:00Z", latest_recorded_timestamp: "2026-04-30T23:00:00Z" };
function start(parentIds: string[] | null = null) {
  const population = populationAnswer({ schema_version: 1, message_type: "open_population_request", request_id: "fixture-open", query_revision: 1, workspace_id: workspaceId, preparation_id: preparationId });
  const onStep = vi.fn<(step: SelectionPredicate) => void>();
  const opening = openingContextAnswer({ schema_version: 1, message_type: "opening_context_request", request_id: "fixture-context", query_revision: 1, workspace_id: workspaceId, identity: population.identity });
  render(<Filters population={population} parentIds={parentIds} opening={{ phase: "ready", answer: opening }} onStep={onStep} range={range} />);
  return { onStep, user: userEvent.setup(), population };
}

describe("map-side whole-incident filters", () => {
  it("applies the exact union and refuses the entire entry containing an unknown number", async () => {
    const app = start();
    await app.user.type(screen.getByLabelText("Exact incident numbers"), "A-1\nB-2");
    await app.user.click(screen.getByRole("button", { name: "Keep these incidents" }));
    expect(app.onStep).toHaveBeenCalledExactlyOnceWith({ kind: "case_id_in", case_ids: ["A-1", "B-2"], negate: false });
    await app.user.clear(screen.getByLabelText("Exact incident numbers"));
    await app.user.type(screen.getByLabelText("Exact incident numbers"), "A-1\nNO-SUCH-ID");
    await app.user.click(screen.getByRole("button", { name: "Keep these incidents" }));
    expect(app.onStep).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toContain("NO-SUCH-ID");
  });

  it("refuses a known number outside the fixed parent and a duplicate without applying", async () => {
    const app = start(["A-1"]);
    await app.user.type(screen.getByLabelText("Exact incident numbers"), "B-2");
    await app.user.click(screen.getByRole("button", { name: "Keep these incidents" }));
    expect(screen.getByRole("alert").textContent).toContain("Outside this parent");
    await app.user.clear(screen.getByLabelText("Exact incident numbers"));
    await app.user.type(screen.getByLabelText("Exact incident numbers"), "A-1\nA-1");
    await app.user.click(screen.getByRole("button", { name: "Keep these incidents" }));
    expect(screen.getByRole("alert").textContent).toContain("more than once");
    expect(app.onStep).not.toHaveBeenCalled();
  });

  it("emits an inclusive chosen four-hour raw-gap threshold, and accepts zero", async () => {
    const app = start();
    await app.user.click(screen.getByText("Recorded time", { selector: "summary" }));
    await app.user.selectOptions(screen.getByLabelText("Measure"), "max_raw_gap_at_least");
    await app.user.type(screen.getByLabelText("At least this many hours"), "4");
    await app.user.click(screen.getByRole("button", { name: "Keep by recorded time" }));
    expect(app.onStep).toHaveBeenLastCalledWith({ kind: "max_raw_gap_at_least", hours: 4, negate: false });
    await app.user.clear(screen.getByLabelText("At least this many hours"));
    await app.user.type(screen.getByLabelText("At least this many hours"), "0");
    await app.user.click(screen.getByRole("button", { name: "Keep by recorded time" }));
    expect(app.onStep).toHaveBeenLastCalledWith({ kind: "max_raw_gap_at_least", hours: 0, negate: false });
  });

  it("does not assign a threshold when the input is blank", async () => {
    const app = start();
    await app.user.click(screen.getByText("Recorded time", { selector: "summary" }));
    await app.user.click(screen.getByRole("button", { name: "Keep by recorded time" }));
    expect(app.onStep).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("finite number");
  });

  it("uses the named UTC clock and an excluded period end without cutting history", async () => {
    const app = start();
    await app.user.click(screen.getByText("First record in a period", { selector: "summary" }));
    fireEvent.change(screen.getByLabelText("First record from (included)"), { target: { value: "2026-04-05T08:00" } });
    fireEvent.change(screen.getByLabelText("Until (excluded)"), { target: { value: "2026-04-06T08:00" } });
    await app.user.click(screen.getByRole("button", { name: "Keep starts in this period" }));
    expect(app.onStep).toHaveBeenLastCalledWith({ kind: "case_start_in_window", window: { timestamp_kind: "utc_instant", start_inclusive: "2026-04-05T08:00:00Z", end_exclusive: "2026-04-06T08:00:00Z" }, negate: false });
    expect(screen.getByText(/All later records remain/)).toBeTruthy();
  });

  it("preserves exact context spaces and missing separately, at any record or the first", async () => {
    const app = start();
    await app.user.click(screen.getByText("Context values", { selector: "summary" }));
    await app.user.type(screen.getByLabelText("Exact context values"), " Unknown \nEast");
    await app.user.click(screen.getByLabelText("Not recorded (distinct from the text “Unknown”)"));
    await app.user.click(screen.getByRole("button", { name: "Keep by context" }));
    expect(app.onStep).toHaveBeenLastCalledWith({ kind: "record_attribute_in", column_index: 3, values: [" Unknown ", "East", null], negate: false });
    await app.user.selectOptions(screen.getByLabelText("Where to look"), "opening");
    await app.user.click(screen.getByRole("button", { name: "Keep by context" }));
    expect(app.onStep).toHaveBeenLastCalledWith({ kind: "opening_attribute_in", column_index: 3, values: [" Unknown ", "East", null], negate: false, anchor_policy: "incident.context.first_record_in_declared_order.v1" });
  });

  it("states the correct scope of a negated any-record predicate", () => {
    expect(stepWording({ kind: "record_attribute_in", column_index: 3, values: ["East", null], negate: true })).toContain("no raw record has");
  });

  it("the emitted kinds remain closed typed selection intents", () => {
    const request = { schema_version: 1, message_type: "select_cases_request", request_id: "fixture-select", query_revision: 1, workspace_id: workspaceId,
      identity: populationAnswer({ schema_version: 1, message_type: "open_population_request", request_id: "fixture-open", query_revision: 1, workspace_id: workspaceId, preparation_id: preparationId }).identity, parent_case_ids: null,
      predicates: [{ kind: "case_id_in", case_ids: ["A-1", "B-2"], negate: false }, { kind: "max_raw_gap_at_least", hours: 4, negate: false }] };
    expect(selectionContract.selectCasesRequest(request)).toBe(true);
    expect(selectionContract.selectCasesRequest({ ...request, predicates: [{ kind: "case_id_in", case_ids: ["A-1", "A-1"], negate: false }] })).toBe(false);
  });
});

describe("#6 a filter previewed before it is taken", () => {
  it("shows what the filter would keep, takes nothing until asked, and can be changed instead", async () => {
    const population = populationAnswer({ schema_version: 1, message_type: "open_population_request", request_id: "p", query_revision: 1, workspace_id: workspaceId, preparation_id: preparationId });
    const onStep = vi.fn();
    const previewStep = vi.fn(async () => ({ ok: true as const, parent: 2, kept: 1, removed: 1, unevaluable: 0 }));
    const opening = openingContextAnswer({ schema_version: 1, message_type: "opening_context_request", request_id: "c", query_revision: 1, workspace_id: workspaceId, identity: population.identity });
    render(<Filters population={population} parentIds={null} opening={{ phase: "ready", answer: opening }} onStep={onStep} previewStep={previewStep} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Exact incident numbers"), "A-1");
    await user.click(screen.getByRole("button", { name: "Keep these incidents" }));
    const step = { kind: "case_id_in", case_ids: ["A-1"], negate: false };
    expect(previewStep).toHaveBeenCalledWith(step, expect.any(AbortSignal));
    expect(onStep).not.toHaveBeenCalled();
    const pending = screen.getByRole("group", { name: "Filter not yet taken" });
    expect(await screen.findByText("Preview: would keep 1 incident of 2 incidents; 1 removed, 0 not evaluable. Nothing changes until the step is taken.")).toBeTruthy();
    expect(pending.textContent).toContain(stepWording(step as SelectionPredicate));
    await user.click(screen.getByRole("button", { name: "Change the filter" }));
    expect(screen.queryByRole("group", { name: "Filter not yet taken" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Keep these incidents" }));
    await user.click(screen.getByRole("button", { name: "Take this step" }));
    expect(onStep).toHaveBeenCalledWith(step);
    expect(screen.queryByRole("group", { name: "Filter not yet taken" })).toBeNull();
  });
});
