import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type CaseListFilters, caseListsAnswering, kept, trendsAnswering } from "./testFakes";
import { TimeColumn } from "./TimeColumn";

function setup({ filters = {}, waitingFor }: { filters?: CaseListFilters; waitingFor?: string } = {}) {
  const onStep = vi.fn();
  const caseLists = caseListsAnswering(filters);
  const trends = trendsAnswering(filters);
  const user = userEvent.setup();
  render(<TimeColumn workspaceId="workspace-1" revision={3} identity={kept} onStep={onStep} waitingFor={waitingFor} caseLists={caseLists} trends={trends} />);
  return { user, onStep, caseLists, trends };
}

const chart = (name: string) => screen.findByRole("group", { name });

describe("the column of time beside the map", () => {
  it("asks for the spans of the kept incidents in the fixed bins, and for their starts in the weeks of the parent's range", async () => {
    const { caseLists, trends } = setup();
    await chart("Incident starts per week");
    const listed = caseLists.list.mock.calls[0][0];
    expect(listed.identity).toEqual(kept);
    expect(listed.query.distribution).toEqual({ measure: "observed_span_hours", edges_hours: [0, 1, 4, 24, 72, 168, 336, 720, 2160, 8760] });
    const asked = trends.trend.mock.calls[0][0];
    expect(asked.identity).toEqual(kept);
    expect(asked.definition).toEqual({
      policy_id: "incident.start_trend.first_raw_declared_order_half_open.v1",
      binning: { kind: "explicit_edges", timestamp_kind: "utc_instant", edges: ["2025-03-03T00:00:00Z", "2025-03-10T00:00:00Z", "2025-03-17T00:00:00Z", "2025-03-24T00:00:00Z"] },
    });
    expect(screen.getByText("Recorded span")).toBeTruthy();
    expect(screen.getByText("Starts per week")).toBeTruthy();
  });

  it("keeps the incidents whose first record lies in a band of weeks chosen with the keyboard, with exactly the answered bounds, at once", async () => {
    const { user, onStep } = setup();
    const starts = await chart("Incident starts per week");
    starts.focus();
    await user.keyboard("{ArrowRight}{Shift>}{ArrowRight}{/Shift}");
    expect(within(starts.parentElement!).getByText("3 Mar 2025 to 16 Mar 2025")).toBeTruthy();
    await user.keyboard("{Enter}");
    expect(onStep).toHaveBeenCalledWith({
      kind: "case_start_in_window",
      window: { timestamp_kind: "utc_instant", start_inclusive: "2025-03-03T00:00:00Z", end_exclusive: "2025-03-17T00:00:00Z" },
      negate: false,
    });
    // The step taken, the chart is neutral again.
    expect(starts.getAttribute("data-chosen")).toBeNull();
  });

  it("keeps the incidents of at least a span from its column, and takes no step from the column that starts at zero", async () => {
    const { user, onStep } = setup();
    const spans = await chart("Incidents by recorded span");
    spans.focus();
    await user.keyboard("{ArrowRight}{Enter}");
    expect(onStep).not.toHaveBeenCalled();
    await user.keyboard("{ArrowRight}{Enter}");
    expect(onStep).toHaveBeenCalledWith({ kind: "observed_span_at_least", hours: 1, negate: false });
  });

  it("says in the amber of a limit how many kept incidents have no span, no first time, or start outside the periods", async () => {
    setup({ filters: { withoutSpan: 3, withoutFirstTime: 2, outside: 1 } });
    expect(await screen.findByText("3 incidents without a span")).toBeTruthy();
    expect(await screen.findByText("2 incidents without a first time")).toBeTruthy();
    expect(screen.getByText("1 incident start outside these periods").className).toBe("time-chart-limit");
  });

  it("takes no step while another is under way", async () => {
    const { user, onStep } = setup({ waitingFor: "waiting" });
    const starts = await chart("Incident starts per week");
    starts.focus();
    await user.keyboard("{ArrowRight}{Enter}");
    expect(onStep).not.toHaveBeenCalled();
    expect(starts.getAttribute("aria-describedby")).toContain("waiting");
  });

  it("says why the starts are not shown when the service refuses them, and still shows the spans", async () => {
    setup({ filters: { refuseTrend: "The parent changed." } });
    expect(await screen.findByText("Starts are not shown: The parent changed.")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("group", { name: "Incidents by recorded span" })).toBeTruthy());
  });
});
