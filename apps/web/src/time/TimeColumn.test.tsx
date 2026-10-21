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
  it("asks for the spans of the kept cases in the fixed bins, and for their starts in the weeks of the parent's range", async () => {
    const { caseLists, trends } = setup();
    await chart("Case starts per week");
    const listed = caseLists.list.mock.calls[0][0];
    expect(listed.identity).toEqual(kept);
    expect(listed.query.distribution).toEqual({ measure: "observed_span_hours", edges_hours: [0, 1, 4, 24, 72, 168, 336, 720, 2160, 8760] });
    const asked = trends.trend.mock.calls[0][0];
    expect(asked.identity).toEqual(kept);
    expect(asked.definition).toEqual({
      policy_id: "incident.start_trend.first_raw_declared_order_half_open.v1",
      binning: { kind: "explicit_edges", timestamp_kind: "utc_instant", edges: ["2025-03-03T00:00:00Z", "2025-03-10T00:00:00Z", "2025-03-17T00:00:00Z", "2025-03-24T00:00:00Z"] },
    });
    expect(screen.getByText("Cases by recorded span", { selector: "h5" })).toBeTruthy();
    expect(screen.getByText("Case starts per week", { selector: "h5" })).toBeTruthy();
  });

  it("keeps the cases whose first record lies in a band of weeks chosen with the keyboard, with exactly the answered bounds, at once", async () => {
    const { user, onStep } = setup();
    const starts = await chart("Case starts per week");
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

  it("keeps the cases of at least a span from its column, and takes no step from the column that starts at zero", async () => {
    const { user, onStep } = setup();
    const spans = await chart("Cases by recorded span");
    spans.focus();
    await user.keyboard("{ArrowRight}{Enter}");
    expect(onStep).not.toHaveBeenCalled();
    await user.keyboard("{ArrowRight}{Enter}");
    expect(onStep).toHaveBeenCalledWith({ kind: "observed_span_at_least", hours: 1, negate: false });
  });

  it("says in the amber of a limit how many kept cases have no span, no first time, or start outside the periods", async () => {
    setup({ filters: { withoutSpan: 3, withoutFirstTime: 2, outside: 1 } });
    expect(await screen.findByText("3 cases without a span")).toBeTruthy();
    expect(await screen.findByText("2 cases without a first time")).toBeTruthy();
    expect(screen.getByText("1 case start outside these periods").className).toBe("time-chart-limit");
  });

  it("takes no step while another is under way", async () => {
    const { user, onStep } = setup({ waitingFor: "waiting" });
    const starts = await chart("Case starts per week");
    starts.focus();
    await user.keyboard("{ArrowRight}{Enter}");
    expect(onStep).not.toHaveBeenCalled();
    expect(starts.getAttribute("aria-describedby")).toContain("waiting");
  });

  it("says why the starts are not shown when the service refuses them, and still shows the spans", async () => {
    setup({ filters: { refuseTrend: "The parent changed." } });
    expect(await screen.findByText("Starts are not shown: The parent changed.")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("group", { name: "Cases by recorded span" })).toBeTruthy());
  });

  it("says why both charts are not shown when the spans cannot be read, never waits for the starts, and asks again on request", async () => {
    const { user, trends } = setup({ filters: { unreachableOnce: true } });
    expect(await screen.findByText("Spans are not shown: It could not be read from the local service.")).toBeTruthy();
    expect(screen.getByText("Starts are not shown: the recorded range of the parent could not be read")).toBeTruthy();
    expect(screen.queryByText("Counting starts…")).toBeNull();
    expect(trends.trend).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole("button", { name: "Ask again" })[0]);
    expect(await chart("Case starts per week")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Cases by recorded span" })).toBeTruthy();
  });
});

describe("#11 a start period previewed before it is taken, explained, and expanded as a table", () => {
  function previewing() {
    const onStep = vi.fn();
    const previewStep = vi.fn(async () => ({ ok: true as const, parent: 10, kept: 4, removed: 6, unevaluable: 0, keptIds: [] }));
    render(<TimeColumn workspaceId="workspace-1" revision={3} identity={kept} onStep={onStep} previewStep={previewStep} caseLists={caseListsAnswering({})} trends={trendsAnswering({})} />);
    return { onStep, previewStep, user: userEvent.setup() };
  }
  const week = { kind: "case_start_in_window", window: { timestamp_kind: "utc_instant", start_inclusive: "2025-03-03T00:00:00Z", end_exclusive: "2025-03-10T00:00:00Z" }, negate: false };

  it("previews a band from the chart and applies it only on request", async () => {
    const { onStep, previewStep, user } = previewing();
    const starts = await chart("Case starts per week");
    starts.focus();
    await user.keyboard("{ArrowRight}{Enter}");
    expect(onStep).not.toHaveBeenCalled();
    expect(previewStep).toHaveBeenCalledWith(week, expect.any(AbortSignal));
    const pending = screen.getByRole("group", { name: "Step from the time charts not yet applied" });
    expect(await within(pending).findByText(/^Preview: would keep 4 cases of 10 cases/)).toBeTruthy();
    await user.click(within(pending).getByRole("button", { name: "Apply" }));
    expect(onStep).toHaveBeenCalledWith(week);
  });

  it("names the anchor, the half-open periods, the clock and cutoff, and warns about short recent follow-up", async () => {
    previewing();
    await chart("Case starts per week");
    expect(screen.getByText(/^Each case counts once, at the time of its first record in the declared order, not at its first labelled activity\. A period includes its start\s+and excludes its end, in UTC; the export was taken at/)).toBeTruthy();
    expect(screen.getByText(/a recent period with fewer late records does\s+not by itself show an improvement/)).toBeTruthy();
  });

  it("expands the same answer as a table whose rows give the same step as the chart, and returns the focus on closing", async () => {
    const { previewStep, user } = previewing();
    await chart("Case starts per week");
    const expand = screen.getByRole("button", { name: "Expand the starts" });
    await user.click(expand);
    const expanded = screen.getByRole("region", { name: "Case starts per week, expanded" });
    const rows = within(expanded).getAllByRole("row").slice(1);
    expect(rows.length).toBeGreaterThan(1);
    await user.click(within(expanded).getByRole("button", { name: "Keep cases that start in 3 Mar 2025 to 9 Mar 2025" }));
    expect(previewStep).toHaveBeenLastCalledWith(week, expect.any(AbortSignal));
    expect(screen.queryByRole("region", { name: "Case starts per week, expanded" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Expand the starts" })));
  });
});
