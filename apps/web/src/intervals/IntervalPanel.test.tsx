import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { IntervalDistributionAnswer, IntervalDistributionRequest } from "../generated/interval-tail";
import type { SelectionPredicate } from "../generated/selection";
import { stepWording, unevaluableReason } from "../map/wording";
import { identity, workspaceId } from "../test/imports";
import { intervalContract } from "./client";
import { INTERVAL_EDGES_HOURS, IntervalPanel } from "./IntervalPanel";

const POLICY = "incident.interval.first_start_first_response_at_or_after.v1";

function answerFor(request: IntervalDistributionRequest): IntervalDistributionAnswer {
  const bins = INTERVAL_EDGES_HOURS.map((start, index) => ({ start_inclusive_hours: start, end_exclusive_hours: INTERVAL_EDGES_HOURS[index + 1] ?? null,
    parent_case_count: start === 4 ? 2 : start === 0 ? 1 : 0, kept_case_count: start === 4 ? 2 : start === 0 ? 1 : 0 }));
  return {
    schema_version: 1, message_type: "interval_distribution_answer", request_id: request.request_id, query_revision: request.query_revision,
    workspace_id: request.workspace_id, identity: request.identity, parent_identity: request.identity, interval: request.interval, unit: "hours",
    clock: { timestamp_kind: "utc_instant", duration_basis: "elapsed_utc", snapshot_cutoff: "2026-12-31T00:00:00Z" }, edges_hours: request.edges_hours, bins,
    measured: { parent_case_count: 3, kept_case_count: 3 },
    unavailable: [{ reason: "order_unknown", parent_case_count: 1, kept_case_count: 1 }, { reason: "missing_start", parent_case_count: 0, kept_case_count: 0 },
      { reason: "missing_response", parent_case_count: 1, kept_case_count: 1 }],
    cases: [
      { case_id: "I-5H", hours: 5, reason: null, start_row_id: null, response_row_id: null, start_source_position: 4, response_source_position: 5 },
      { case_id: "I-4H", hours: 4, reason: null, start_row_id: null, response_row_id: null, start_source_position: 2, response_source_position: 3 },
      { case_id: "I-NORESP", hours: null, reason: "missing_response", start_row_id: null, response_row_id: null, start_source_position: 9, response_source_position: null },
    ],
    cases_truncated: false,
  } as IntervalDistributionAnswer;
}

function panel() {
  const requests: IntervalDistributionRequest[] = [];
  const client = { distribution: vi.fn(async (request: IntervalDistributionRequest) => { requests.push(request); return { ok: true as const, answer: answerFor(request) }; }) };
  const onStep = vi.fn<(step: SelectionPredicate) => void>(), onOpenCase = vi.fn();
  const previewStep = vi.fn(async (_step: SelectionPredicate, _signal: AbortSignal) => ({ ok: true as const, parent: 5, kept: 2, removed: 1, unevaluable: 2, keptIds: ["I-4H", "I-5H"] }));
  render(<IntervalPanel workspaceId={workspaceId} revision={3} identity={identity} activities={["Opened", "Resolved"]} onStep={onStep}
    previewStep={previewStep} onOpenCase={onOpenCase} client={client} />);
  return { requests, onStep, onOpenCase, previewStep, user: userEvent.setup() };
}

describe("#10 one supported interval, its distribution and its tail", () => {
  it("measures the named interval over bins the parent fixes, with the incidents without it by reason", async () => {
    const app = panel();
    await app.user.selectOptions(screen.getByLabelText("Response activity"), "Resolved");
    await app.user.click(screen.getByRole("button", { name: "Measure the interval" }));
    expect(intervalContract.request(app.requests[0])).toBe(true);
    expect(app.requests[0].interval).toEqual({ policy: POLICY, start_activity: "Opened", response_activity: "Resolved" });
    expect(app.requests[0].edges_hours).toEqual(INTERVAL_EDGES_HOURS);
    expect(await screen.findByText(/^From the first “Opened” to the first “Resolved” at or after it, in hours, as elapsed time in UTC\./)).toBeTruthy();
    expect(screen.getByText(/Other pairings, such as the last start, the final response or cycles, are not offered/)).toBeTruthy();
    const reasons = screen.getByRole("table", { name: "Incidents without this interval, by reason" });
    expect(within(reasons).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["Order not known: a record has no usable time", "No start", "No response at or after the start"]);
    expect(screen.getByText(/they are in no bin and in no tail/)).toBeTruthy();
    const listed = screen.getByRole("list", { name: "Intervals of these incidents, longest first" });
    expect(within(listed).getAllByRole("listitem").map((item) => item.firstChild?.textContent)).toEqual([
      "I-5H: from the record at source position 4 to the record at source position 5, 5 h.",
      "I-4H: from the record at source position 2 to the record at source position 3, 4 h.",
      "I-NORESP: no interval (no response at or after the start).",
    ]);
    await app.user.click(within(listed).getByRole("button", { name: "Open I-4H" }));
    expect(app.onOpenCase).toHaveBeenCalledWith("I-4H");
    expect(screen.getByRole("status").textContent).toBe("I-4H: from the record at source position 2 to the record at source position 3, 4 h.");
  });

  it("gives the same inclusive step from a bin as from the form, previews it, and applies or cancels", async () => {
    const app = panel();
    await app.user.selectOptions(screen.getByLabelText("Response activity"), "Resolved");
    await app.user.click(screen.getByRole("button", { name: "Measure the interval" }));
    await app.user.click(await screen.findByRole("button", { name: "Keep from 4 h up" }));
    const fromBin = app.previewStep.mock.calls.at(-1)![0];
    expect(fromBin).toEqual({ kind: "interval_threshold", interval: { policy: POLICY, start_activity: "Opened", response_activity: "Resolved" }, operator: "ge", hours: 4, negate: false });
    await app.user.click(within(screen.getByRole("group", { name: "Tail not yet applied" })).getByRole("button", { name: "Cancel" }));
    expect(app.onStep).not.toHaveBeenCalled();
    // The form, at least 4 hours: the same step.
    await app.user.clear(screen.getByLabelText("Threshold in hours"));
    await app.user.type(screen.getByLabelText("Threshold in hours"), "4");
    await app.user.click(screen.getByLabelText(/^at least the threshold/));
    await app.user.click(screen.getByRole("button", { name: "Preview this tail" }));
    expect(app.previewStep.mock.calls.at(-1)![0]).toEqual(fromBin);
    // Strict: more than 4 hours.
    await app.user.click(screen.getByLabelText(/^more than the threshold/));
    await app.user.click(screen.getByRole("button", { name: "Preview this tail" }));
    const strict = { ...fromBin, operator: "gt" };
    expect(app.previewStep.mock.calls.at(-1)![0]).toEqual(strict);
    expect(await screen.findByText(/^Preview: would keep 2 incidents of 5 incidents/)).toBeTruthy();
    await app.user.click(screen.getByRole("button", { name: "Apply" }));
    expect(app.onStep).toHaveBeenCalledWith(strict);
    expect(stepWording(strict as SelectionPredicate)).toBe("Keep incidents whose interval from the first “Opened” to the first “Resolved” at or after it is more than 4 hours");
    expect(stepWording(fromBin as SelectionPredicate)).toBe("Keep incidents whose interval from the first “Opened” to the first “Resolved” at or after it is at least 4 hours");
    expect(unevaluableReason(strict as SelectionPredicate)).toContain("no response follows at or after it");
  });
});

describe("#10 back from an incident of the tail", () => {
  it("returns the focus to the button the incident was opened with", async () => {
    const client = { distribution: vi.fn(async (request: IntervalDistributionRequest) => ({ ok: true as const, answer: answerFor(request) })) };
    const props = { workspaceId, revision: 3, identity, activities: ["Opened", "Resolved"], onStep: vi.fn(), onOpenCase: vi.fn(), client };
    const view = render(<IntervalPanel {...props} openCaseId={null} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Response activity"), "Resolved");
    await user.click(screen.getByRole("button", { name: "Measure the interval" }));
    await user.click(await screen.findByRole("button", { name: "Open I-4H" }));
    view.rerender(<IntervalPanel {...props} openCaseId="I-4H" />);
    (document.activeElement as HTMLElement | null)?.blur();
    view.rerender(<IntervalPanel {...props} openCaseId={null} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open I-4H" }));
  });
});
