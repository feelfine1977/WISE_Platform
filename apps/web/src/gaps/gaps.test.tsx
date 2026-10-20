import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GapFigures, GapPairsAnswer, GapPairsRequest } from "../generated/gap-pairs";
import { kept } from "../time/testFakes";
import { populationAnswer, preparationId, workspaceId } from "../test/imports";
import { gapsContract } from "./client";
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
    chosen: request.chosen === null ? null : { ...request.chosen, case_count: 4, cases: [{ case_id: "G-4", longest_hours: 97 }, { case_id: "G-1", longest_hours: 48 }], cases_truncated: false },
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
    expect(order).toMatchObject({ label: "Assign → Resolve", caseIds: ["G-4", "G-1"], ordered: true });
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
});
