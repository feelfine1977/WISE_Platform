import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Bpic19IntervalComparisonAnswer, Bpic19IntervalComparisonRequest } from "../generated/bpic19-interval-comparison";
import targetPage from "./t07-interval-answer.json";
import referencePage from "./t07-interval-reference-page.json";
import { Bpic19IntervalComparison } from "./Bpic19IntervalComparison";
import type { Bpic19IntervalComparisonClient, Bpic19IntervalComparisonOutcome } from "./interval-comparison-client";

// #109 in the browser over the service's own answers for the literal A/G/R/O/Z/T source. The HTTP test
// test_issue109_interval_endpoints_tcp.py requires its live answers to equal these files and asserts the values below.
type Frozen = Omit<Bpic19IntervalComparisonAnswer, "request_id" | "query_revision" | "workspace_id">;
const pages = [targetPage, referencePage] as unknown as Frozen[];
const item = (page: Frozen, caseId: string) => page.comparison.page.items.find(entry => entry.case_id === caseId)!;

function setup() {
  const client: Bpic19IntervalComparisonClient = { compare: vi.fn(async (request: Bpic19IntervalComparisonRequest): Promise<Bpic19IntervalComparisonOutcome> => {
    const page = pages.find(candidate => JSON.stringify(candidate.query) === JSON.stringify(request.query));
    return page ? { ok: true, answer: { ...structuredClone(page), request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id } as Bpic19IntervalComparisonAnswer }
      : { ok: false, problem: { kind: "refusal", refusal: { schema_version: 1, message_type: "bpic19_interval_comparison_refusal", request_id: request.request_id,
          query_revision: request.query_revision, workspace_id: request.workspace_id, operation: "bpic19_interval_comparison", code: "unsupported_policy",
          message: "Only the registered interval policy independent_minimum is admitted.", field: "query.interval_policy", retryable: false } } };
  }) };
  const props = { onInspect: vi.fn(), onKeepCases: vi.fn(), onKeepSide: vi.fn(), onReviewed: vi.fn(), onValidityChange: vi.fn() };
  render(<Bpic19IntervalComparison workspaceId="workspace.v1:t07-literal" identity={pages[0].identity} revision={1} query={pages[0].query} client={client} {...props} />);
  return { ...props, client, user: userEvent.setup() };
}
const distribution = () => screen.findByRole("table", { name: "Interval distributions over explicitly named item sides" });
const cells = (table: HTMLElement, name: RegExp) => within(within(table).getByRole("row", { name })).getAllByRole("cell").map(cell => cell.textContent).slice(0, 8);
async function press(button: HTMLElement, user: ReturnType<typeof userEvent.setup>) { button.focus(); await user.keyboard("{Enter}"); }

describe("#109 interval endpoints over the public literal answers", () => {
  it("E01: shows the admitted distribution and the reasons of the unavailable side", async () => {
    setup();
    const table = await distribution();
    const target = cells(table, /^Target: /);
    expect(target.slice(0, 4)).toEqual(["3 / 9", "3", "1", "0none"]);
    expect(target[4]).toBe("0");
    expect(target[7]).toBe("3");
    const comparator = cells(table, /^Comparator: /);
    expect(comparator.slice(0, 2)).toEqual(["2 / 4", "0"]);
    expect(comparator[3]).toContain("2");
    expect(comparator[3]).toContain("reversed interval: 1");
    expect(comparator[3]).toContain("minimum outside admissible range: 1");
    expect(screen.getByText(/Outside both sides: 1 items/)).toBeTruthy();
  });

  it("T07-AC12/E06: by keyboard, a reversed and a gated item open whole, with their selected minima apart from other candidates", async () => {
    const { user, onInspect } = setup();
    await distribution();
    await user.selectOptions(screen.getByRole("combobox", { name: "Interval evidence side" }), "reference");
    const reference = pages[1];
    await user.click(await screen.findByText(/^Interval item R · reversed interval/));
    const r = item(reference, "R");
    await press(screen.getByRole("button", { name: "Inspect complete interval history R" }), user);
    expect(onInspect).toHaveBeenLastCalledWith("R", r.record_row_ids);
    const rEndpoints = screen.getByRole("table", { name: "Item R original endpoint witnesses" });
    await press(within(rEndpoints).getByRole("button", { name: "Inspect source selected minimum" }), user);
    expect(onInspect).toHaveBeenLastCalledWith("R", r.source.row_ids);
    await press(within(rEndpoints).getByRole("button", { name: "Inspect target selected minimum" }), user);
    expect(onInspect).toHaveBeenLastCalledWith("R", r.target.row_ids);
    expect(rEndpoints.closest("details")!.textContent).toContain("Signed diagnostic: -2 days");
    await user.click(screen.getByText(/^Interval item O · /));
    const o = item(reference, "O");
    const oEndpoints = screen.getByRole("table", { name: "Item O original endpoint witnesses" });
    expect(within(oEndpoints).getByRole("row", { name: /^Source / }).textContent).toContain("minimum outside admissible range");
    await press(within(oEndpoints).getByRole("button", { name: "Inspect source selected minimum" }), user);
    expect(onInspect).toHaveBeenLastCalledWith("O", o.source.row_ids);
  });

  it("E06: co-minima are inspected together, separately from later candidates", async () => {
    const { user, onInspect } = setup();
    await distribution();
    const t = item(pages[0], "T");
    expect(t.source.row_ids).toHaveLength(2);
    await user.click(screen.getByText(/^Interval item T · 3 days/));
    const endpoints = screen.getByRole("table", { name: "Item T original endpoint witnesses" });
    await press(within(endpoints).getByRole("button", { name: "Inspect source selected minimum" }), user);
    expect(onInspect).toHaveBeenLastCalledWith("T", t.source.row_ids);
    const a = item(pages[0], "A");
    await user.click(screen.getByText(/^Interval item A · 1 days/));
    const aEndpoints = screen.getByRole("table", { name: "Item A original endpoint witnesses" });
    await press(within(aEndpoints).getByRole("button", { name: "Inspect target selected minimum" }), user);
    expect(onInspect).toHaveBeenLastCalledWith("A", a.target.row_ids);
    await press(within(aEndpoints).getByRole("button", { name: "Inspect target endpoint evidence" }), user);
    expect(onInspect.mock.calls.at(-1)![1]).toEqual(expect.arrayContaining([...a.target.row_ids, ...a.target.later_row_ids]));
  });

  it("T07-AC12: keeps a side's unavailable items as a typed step of exactly this answer", async () => {
    const { user, onKeepSide, onKeepCases } = setup();
    await distribution();
    await user.click(screen.getByRole("button", { name: "Keep reference unavailable items" }));
    expect(onKeepSide).toHaveBeenCalledTimes(1);
    const [kept, side, support] = onKeepSide.mock.calls[0];
    expect([side, support, kept.definition_id]).toEqual(["reference", "unavailable", pages[0].definition_id]);
    expect([...kept.comparison.reference.unavailable_case_ids].sort()).toEqual(["O", "R"]);
    expect(onKeepCases).not.toHaveBeenCalled();
  });

  it("E02: a refused definition names its code and field and keeps the earlier answer visible but paused", async () => {
    const { user, onKeepSide } = setup();
    await distribution();
    const source = screen.getByRole("textbox", { name: "Comparison source activity selector" });
    await user.clear(source);
    await user.type(source, "Record Goods Receipt");
    await user.click(screen.getByRole("button", { name: "Review interval comparison" }));
    expect((await screen.findByRole("alert")).textContent).toContain("(unsupported_policy · query.interval_policy)");
    const table = await distribution();
    expect(cells(table, /^Target: /)[0]).toBe("3 / 9");
    const keep = screen.getByRole("button", { name: "Keep reference unavailable items" });
    expect(keep.hasAttribute("disabled")).toBe(true);
    await user.click(keep);
    expect(onKeepSide).not.toHaveBeenCalled();
  });
});
