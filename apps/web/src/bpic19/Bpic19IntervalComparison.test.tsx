import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Bpic19IntervalComparisonRequest } from "../generated/bpic19-interval-comparison";
import { Bpic19IntervalComparison } from "./Bpic19IntervalComparison";
import type { Bpic19IntervalComparisonClient, Bpic19IntervalComparisonOutcome } from "./interval-comparison-client";
import { intervalAnswer, intervalRequest } from "./interval-comparison-test-fixture";
const answering = (r: Bpic19IntervalComparisonRequest): Bpic19IntervalComparisonOutcome => ({ ok: true, answer: intervalAnswer(r) });
function setup(client: Bpic19IntervalComparisonClient = { compare: vi.fn(async r => answering(r)) }) {
  const r = intervalRequest();
  const props = { workspaceId: r.workspace_id, identity: r.identity, revision: 2, query: r.query, client,
    onReviewed: vi.fn(), onValidityChange: vi.fn(), onInspect: vi.fn(), onKeepCases: vi.fn(), onReturn: vi.fn() };
  return { ...render(<Bpic19IntervalComparison {...props} />), props, client, user: userEvent.setup() };
}
const distribution = () => screen.findByRole("table", { name: "Interval distributions over explicitly named item sides" });
describe("finite whole-item interval comparison", () => {
  it("keeps eligible, zero and unavailable distinct and exposes complete five-record item evidence", async () => {
    const { user, props } = setup(); const table = await distribution();
    const target = within(table).getByRole("row", { name: /Target: Target zero, one, two and missing/ });
    expect(within(target).getAllByRole("cell").map(c => c.textContent).slice(0,8)).toEqual(["4 / 10","3","1","1no parsed endpoint: 1","0","1","1","2"]);
    const comparator = within(table).getByRole("row", { name: /Comparator: Comparator two and reversed/ });
    expect(within(comparator).getAllByRole("cell").map(c => c.textContent).slice(0,8)).toEqual(["2 / 4","1","0","1reversed interval: 1","2","2","2","2"]);
    await user.click(screen.getByRole("button", { name: "Keep target zero-day items" })); expect(props.onKeepCases).toHaveBeenLastCalledWith(["T0"]);
    await user.click(screen.getByRole("button", { name: "Keep target unavailable items" })); expect(props.onKeepCases).toHaveBeenLastCalledWith(["TM"]);
    await user.click(screen.getByText("Interval item T0 · 0 days"));
    await user.click(screen.getByRole("button", { name: "Inspect complete interval history T0" }));
    expect(props.onInspect).toHaveBeenLastCalledWith("T0", intervalAnswer().comparison.page.items[0].record_row_ids);
    expect(props.onInspect.mock.calls.at(-1)?.[1]).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: "Keep complete interval item T0" })); expect(props.onKeepCases).toHaveBeenLastCalledWith(["T0"]);
    await user.click(within(screen.getByRole("table", { name: "Item T0 original endpoint witnesses" })).getByRole("button", { name: "Inspect source endpoint evidence" }));
    expect(props.onInspect).toHaveBeenLastCalledWith("T0", intervalAnswer().comparison.page.items[0].source.candidate_row_ids);
    await user.selectOptions(screen.getByRole("combobox", { name: "Interval evidence side" }), "reference");
    await screen.findByText("Interval item RN · reversed interval"); await user.click(screen.getByText("Interval item RN · reversed interval"));
    expect(screen.getByText(/Signed diagnostic: -1 days/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep complete interval item RN" })); expect(props.onKeepCases).toHaveBeenLastCalledWith(["RN"]);
  });
  it("pauses dirty endpoints and restores before reviewing explicit empty side IDs", async () => {
    const { user, props, client } = setup(); await distribution();
    await user.clear(screen.getByRole("textbox", { name: "Comparison source activity selector" }));
    expect(props.onValidityChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: "Keep target items" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Review interval comparison" }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Restore reviewed interval comparison" }));
    expect(vi.mocked(client.compare)).toHaveBeenCalledTimes(1); await waitFor(() => expect(props.onValidityChange).toHaveBeenLastCalledWith(true));
    await user.clear(screen.getByRole("textbox", { name: "Target complete item IDs" }));
    const source = screen.getByRole("textbox", { name: "Comparison source activity selector" }); await user.clear(source); await user.type(source, "Record Goods Receipt{enter}Record Service Entry Sheet");
    await user.click(screen.getByRole("button", { name: "Review interval comparison" }));
    expect(vi.mocked(client.compare).mock.calls[1][0].query).toMatchObject({ interval_source: ["Record Goods Receipt","Record Service Entry Sheet"],
      target: { recipe: {kind:"complete_case_ids",case_ids:[]}}, reference: {recipe:{kind:"complete_case_ids",case_ids:["R2","RN"]}} });
  });
  it.each(["success","error"])("fences delayed %s after changing the source parent", async outcome => {
    let release: ((value: Bpic19IntervalComparisonOutcome) => void) | undefined;
    const client: Bpic19IntervalComparisonClient = { compare: vi.fn((r: Bpic19IntervalComparisonRequest): Promise<Bpic19IntervalComparisonOutcome> => r.query_revision === 2
      ? new Promise(resolve => { release = resolve; }) : Promise.resolve(answering(r))) };
    const { rerender, props } = setup(client); const old = vi.mocked(client.compare).mock.calls[0][0];
    rerender(<Bpic19IntervalComparison {...props} revision={3} />); await distribution();
    await act(async () => { release?.(outcome === "success" ? answering(old) : {ok:false,problem:{kind:"unreachable"}}); });
    expect(props.onReviewed).toHaveBeenCalledTimes(1); expect(props.onReviewed.mock.calls[0][0].query_revision).toBe(3); expect(screen.queryByRole("alert")).toBeNull();
  });
  it("aborts an outstanding page on editing and ignores delayed evidence", async () => {
    let release: ((value: Bpic19IntervalComparisonOutcome) => void) | undefined;
    const client: Bpic19IntervalComparisonClient = { compare: vi.fn((r: Bpic19IntervalComparisonRequest): Promise<Bpic19IntervalComparisonOutcome> => r.query.page.role === "reference"
      ? new Promise(resolve => { release = resolve; }) : Promise.resolve(answering(r))) };
    const { user, props } = setup(client); await distribution();
    await user.selectOptions(screen.getByRole("combobox", { name: "Interval evidence side" }), "reference"); const pending = vi.mocked(client.compare).mock.calls[1];
    await user.type(screen.getByRole("textbox", {name:"Target name"}), " revised"); expect(pending[1].aborted).toBe(true);
    await act(async () => { release?.(answering(pending[0])); }); expect(props.onReviewed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", {name:"Keep target items"}).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", {name:"Restore reviewed interval comparison"})); await waitFor(() => expect(props.onValidityChange).toHaveBeenLastCalledWith(true));
  });
});
