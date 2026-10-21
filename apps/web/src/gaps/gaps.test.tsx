import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GapFigures, GapPairsAnswer, GapPairsRequest } from "../generated/gap-pairs";
import { kept } from "../time/testFakes";
import { populationAnswer, preparationId, workspaceId } from "../test/imports";
import { answersGaps, gapsContract, type GapsOutcome } from "./client";
import { GapPairs } from "./GapPairs";
import { PathGaps } from "./PathGaps";

// #61: the pairs that carry the longest recorded gaps, kept against the parent; a pair orders the incident list.
const figures = (incidents: number, passages: number, median: number | null, p90: number | null, above = 0): GapFigures => ({
  incident_count: incidents, incident_share: incidents / 6, passage_count: passages, median_hours: median, p90_hours: p90, above_threshold_passage_count: above, above_threshold_incident_count: above,
});

function answering(request: GapPairsRequest): GapPairsAnswer {
  const raw = request.relation === "raw_adjacent";
  return {
    schema_version: 1, message_type: "gap_pairs_answer", request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id,
    identity: request.identity, parent_identity: request.identity, relation: request.relation, weighting_policy: "incident.gap.weighting.each_passage_once.v1",
    quantile_policy: "incident.gap.quantiles.median_midpoint_p90_nearest_rank.v1", threshold_hours: request.threshold_hours,
    kept: { case_count: 6, evaluable_case_count: 6, order_unknown_case_count: 0 }, parent: { case_count: 8, evaluable_case_count: 7, order_unknown_case_count: 1 },
    pair_count: 2,
    pairs: [
      { from_activity: "Assign", to_activity: "Resolve", kept: figures(4, 4, 26, 97, 2), parent: figures(4, 4, 26, 97, 2) },
      ...(raw ? [{ from_activity: null, to_activity: "Resolve", kept: figures(1, 1, 20, 20), parent: figures(1, 1, 20, 20) }] : []),
    ],
    pairs_truncated: false,
    chosen: request.chosen === null ? null : { ...request.chosen, case_count: 4, case_offset: request.case_offset ?? 0,
      kept: figures(4, 4, 26, 97, 2), parent: figures(4, 4, 26, 97, 2),
      cases: [{ case_id: "G-4", longest_hours: 97 }, { case_id: "G-1", longest_hours: 48 }, { case_id: "G-3", longest_hours: 4 }, { case_id: "G-6", longest_hours: 1 }].slice(request.case_offset ?? 0, (request.case_offset ?? 0) + request.case_limit), cases_truncated: (request.case_offset ?? 0) + request.case_limit < 4 },
  };
}

function client() {
  return { gaps: vi.fn(async (request: GapPairsRequest) => ({ ok: true as const, answer: answering(request) })) };
}

describe("the longest recorded gaps", () => {
  it("lists each pair with its incidents and share, passages, median and 90th percentile for the kept incidents and the parent", async () => {
    const gaps = client();
    render(<GapPairs workspaceId="w" revision={3} identity={kept} onOrder={vi.fn()} ordered={null} client={gaps} />);
    const table = await screen.findByRole("table", { name: "Pairs with their recorded gaps, the longest 90th percentile first" });
    const rows = within(table).getAllByRole("row").slice(2).map((row) => Array.from(row.children, (cell) => cell.textContent));
    expect(rows).toEqual([
      ["Assign → Resolve", "4 · 66.7%", "4", "26", "97", "2 in 2", "4 · 66.7%", "4", "26", "97"],
      ["(no activity label) → Resolve", "1 · 16.7%", "1", "20", "20", "0 in 0", "1 · 16.7%", "1", "20", "20"],
    ]);
    expect(screen.getByText(/^A gap is the recorded time from one record to the next\. It is not a working or a waiting time/)).toBeTruthy();
    expect(screen.getByText(/each passage of a pair counts once, an incident passing it twice twice\. The median is the middle passage/)).toBeTruthy();
    expect(screen.getByText(/^0 kept incidents \(parent 1\) whose order of records is not known/)).toBeTruthy();
    expect(gaps.gaps.mock.calls[0][0]).toMatchObject({ relation: "raw_adjacent", threshold_hours: 24, chosen: null });
  });

  it("reads the gaps along the map's paths on request, and counts the passages longer than the threshold typed", async () => {
    const gaps = client();
    const user = userEvent.setup();
    render(<GapPairs workspaceId="w" revision={3} identity={kept} onOrder={vi.fn()} ordered={null} client={gaps} />);
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Along the map's paths" }));
    expect(gaps.gaps.mock.calls.at(-1)![0].relation).toBe("mapped_path");
    expect(await screen.findByText(/A record without an activity label is passed over, as on the map's paths\./)).toBeTruthy();
    await user.clear(screen.getByLabelText("Longer than (hours)"));
    await user.type(screen.getByLabelText("Longer than (hours)"), "48");
    await user.click(screen.getByRole("button", { name: "Count" }));
    expect(gaps.gaps.mock.calls.at(-1)![0].threshold_hours).toBe(48);
  });

  it("orders the incident list by a chosen pair's longest gap, without a step, and lets the order go on a second choice", async () => {
    const gaps = client();
    const onOrder = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<GapPairs workspaceId="w" revision={3} identity={kept} onOrder={onOrder} ordered={null} client={gaps} />);
    await user.click(await screen.findByRole("button", { name: "Assign → Resolve" }));
    expect(gaps.gaps.mock.calls.at(-1)![0].chosen).toEqual({ from_activity: "Assign", to_activity: "Resolve" });
    const order = onOrder.mock.calls[0][0];
    expect(order).toMatchObject({ label: "Assign → Resolve", caseIds: ["G-4", "G-1", "G-3", "G-6"], ordered: true });
    expect(order.note).toBe("The table lists the 4 kept incidents with a gap Assign → Resolve, the longest of their gaps first. This is an order of the list: the selection and every count stay as they are until a step is taken.");
    rerender(<GapPairs workspaceId="w" revision={3} identity={kept} onOrder={onOrder} ordered={order.id} client={gaps} />);
    expect(screen.getByRole("button", { name: "Assign → Resolve" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Assign → Resolve" }));
    expect(onOrder).toHaveBeenLastCalledWith(null);
  });

  it("gives a selected path of the map its 90th percentile lag and its passages longer than a threshold", async () => {
    const gaps = client();
    render(<PathGaps workspaceId="w" revision={3} identity={kept} source="Assign" target="Resolve" client={gaps} />);
    expect((await screen.findByText(/^90th percentile lag/)).textContent).toBe(
      "90th percentile lag 97 h over 4 passages; 2 passages are longer than 24 h, in 2 incidents. A recorded gap, not a working or waiting time.");
    expect(gaps.gaps.mock.calls[0][0]).toMatchObject({ relation: "mapped_path", threshold_hours: 24 });
  });

  it("asks what the contract allows", () => {
    const { identity } = populationAnswer({ schema_version: 1, message_type: "open_population_request", request_id: "o", query_revision: 1, workspace_id: workspaceId, preparation_id: preparationId });
    expect(gapsContract.request({ schema_version: 1, message_type: "gap_pairs_request", request_id: "r", query_revision: 1, workspace_id: workspaceId, identity,
      relation: "raw_adjacent", threshold_hours: 24, limit: 50, chosen: { from_activity: null, to_activity: "Resolve" }, case_limit: 10 })).toBe(true);
  });

  it("reads every page before making a 1,001-incident group available for a step", async () => {
    let finish!: (outcome: GapsOutcome) => void;
    const lastPage = new Promise<GapsOutcome>((resolve) => { finish = resolve; });
    const members = Array.from({ length: 1001 }, (_, i) => ({ case_id: `G-${i}`, longest_hours: 1001 - i }));
    let second!: GapPairsRequest;
    const gaps = { gaps: vi.fn(async (request: GapPairsRequest): Promise<GapsOutcome> => {
      const answer = answering(request);
      if (answer.chosen !== null) {
        if (request.case_offset === 1000) { second = request; return lastPage; }
        answer.chosen = { ...answer.chosen, case_count: 1001, cases: members.slice(0, 1000), cases_truncated: true };
      }
      return { ok: true, answer };
    }) };
    const onOrder = vi.fn();
    render(<GapPairs workspaceId="w" revision={3} identity={kept} onOrder={onOrder} ordered={null} client={gaps} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Assign → Resolve" }));
    await waitFor(() => expect(second.case_offset).toBe(1000));
    expect(onOrder).not.toHaveBeenCalled();
    const answer = answering(second);
    answer.chosen = { ...answer.chosen!, case_count: 1001, cases: members.slice(1000), cases_truncated: false };
    await act(async () => finish({ ok: true, answer }));
    expect(onOrder).toHaveBeenCalledTimes(1);
    expect(onOrder.mock.calls[0][0].caseIds).toEqual(members.map((member) => member.case_id));
    expect(onOrder.mock.calls[0][0].note).toContain("1,001 kept incidents");
  });

  it("does not publish an old chosen group after the population changes", async () => {
    let finish!: (outcome: GapsOutcome) => void;
    let chosen!: GapPairsRequest;
    let signal!: AbortSignal;
    const pending = new Promise<GapsOutcome>((resolve) => { finish = resolve; });
    const gaps = { gaps: vi.fn(async (request: GapPairsRequest, abort: AbortSignal): Promise<GapsOutcome> => {
      if (request.chosen) { chosen = request; signal = abort; return pending; }
      return { ok: true, answer: answering(request) };
    }) };
    const onOrder = vi.fn();
    const { rerender } = render(<GapPairs workspaceId="w" revision={3} identity={kept} onOrder={onOrder} ordered={null} client={gaps} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Assign → Resolve" }));
    rerender(<GapPairs workspaceId="w" revision={4} identity={{ ...kept, population_id: "new-population" }} onOrder={onOrder} ordered={null} client={gaps} />);
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ ok: true, answer: answering(chosen) }));
    expect(onOrder).not.toHaveBeenCalled();
  });

  it("keeps a partial or failed member page from becoming a group", async () => {
    const gaps = client();
    gaps.gaps.mockImplementation(async (request) => {
      const answer = answering(request);
      if (answer.chosen) answer.chosen = { ...answer.chosen, case_count: 5, cases_truncated: false };
      return { ok: true, answer };
    });
    const onOrder = vi.fn();
    render(<GapPairs workspaceId="w" revision={3} identity={kept} onOrder={onOrder} ordered={null} client={gaps} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Assign → Resolve" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Every incident of this pair could not be read");
    expect(onOrder).not.toHaveBeenCalled();
  });

  it("uses exact chosen-path figures even when the path is outside the ranked list", async () => {
    const gaps = client();
    gaps.gaps.mockImplementation(async (request) => ({ ok: true, answer: { ...answering(request), pairs: [], pair_count: 201, pairs_truncated: true } }));
    render(<PathGaps workspaceId="w" revision={3} identity={kept} source="Assign" target="Resolve" client={gaps} />);
    expect((await screen.findByText(/^90th percentile lag/)).textContent).toContain("97 h over 4 passages");
    expect(gaps.gaps.mock.calls[0][0].chosen).toEqual({ from_activity: "Assign", to_activity: "Resolve" });
    expect(screen.queryByText(/^No kept incident passes/)).toBeNull();
  });

  it("rejects a reply for another chosen pair or member page", () => {
    const request: GapPairsRequest = { schema_version: 1, message_type: "gap_pairs_request", request_id: "gaps", query_revision: 1,
      workspace_id: "w", identity: kept, relation: "mapped_path", threshold_hours: 24, limit: 1,
      chosen: { from_activity: "Assign", to_activity: "Resolve" }, case_offset: 2, case_limit: 2 };
    const answer = answering(request);
    expect(answersGaps(request, answer)).toBe(true);
    expect(answersGaps(request, { ...answer, chosen: { ...answer.chosen!, case_offset: 0 } })).toBe(false);
    expect(answersGaps(request, { ...answer, chosen: { ...answer.chosen!, to_activity: "Other" } })).toBe(false);
  });
});
