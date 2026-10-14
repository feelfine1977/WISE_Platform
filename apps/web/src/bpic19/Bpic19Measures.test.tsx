import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Bpic19MeasuresRequest } from "../generated/bpic19-measures";
import { Bpic19Measures } from "./Bpic19Measures";
import type { Bpic19MeasuresClient, Bpic19MeasuresOutcome } from "./measures-client";
import { measuresAnswer, measuresColumns, measuresIdentity, measuresRoles } from "./measures-test-fixture";

const answering = (request: Bpic19MeasuresRequest): Bpic19MeasuresOutcome => ({ ok: true, answer: measuresAnswer(request) });
function setup(client: Bpic19MeasuresClient = { measures: vi.fn(async request => answering(request)) }) {
  const props = { workspaceId: "workspace.v1:literal-fixture", identity: measuresIdentity, revision: 2, roles: measuresRoles, columns: measuresColumns,
    client, onInspect: vi.fn(), onReviewed: vi.fn(), onKeepCases: vi.fn(), onValidityChange: vi.fn() };
  return { ...render(<Bpic19Measures {...props} />), props, client, user: userEvent.setup() };
}
const distributions = () => screen.findByRole("table", { name: "Raw-measure distributions over the complete named population" });

describe("source-witnessed BPIC19 measures", () => {
  it("separates known zero, unavailable and lower bounds while retaining complete-history and suppressed-row evidence", async () => {
    const { user, props } = setup();
    const table = await distributions();
    const count = within(table).getByRole("row", { name: /Invoice receipt occurrences/ });
    expect(within(count).getAllByRole("cell").map(cell => cell.textContent)).toEqual(["2", "1", "1", "0", "1", "1", "2"]);
    const interval = within(table).getByRole("row", { name: /Earliest invoice to earliest clearing/ });
    expect(within(interval).getAllByRole("cell").map(cell => cell.textContent)).toEqual(["0", "0", "3", "unavailable", "unavailable", "unavailable", "unavailable"]);
    await user.click(screen.getByRole("button", { name: "Keep known zero items" }));
    expect(props.onKeepCases).toHaveBeenCalledWith(["B_1"], "count: known zero");
    await user.click(screen.getByText("Item A_1 · DF1 · 6 records"));
    const evidence = await screen.findByRole("table", { name: "Item A_1 raw values and record witnesses" });
    expect(within(evidence).getAllByText("Signed diagnostic: -1 days")).toHaveLength(2);
    expect(within(evidence).getAllByText(/reversed interval/)).toHaveLength(2);
    expect(screen.getByText("Co-minimum records: row-3, row-4")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Inspect source candidates" }));
    expect(props.onInspect).toHaveBeenLastCalledWith("A_1", ["row-3", "row-4"]);
    expect(screen.getByText('" USER_1 "')).toBeTruthy();
    expect(screen.getByText('"1E+2"')).toBeTruthy();
    expect(screen.getByText('"NaN"')).toBeTruthy();
    expect(screen.getByText("row-2, row-4")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Inspect suppressed occurrences of A_1" }));
    expect(props.onInspect).toHaveBeenLastCalledWith("A_1", ["row-2", "row-4"]);
    await user.click(screen.getByRole("button", { name: "Inspect actor record row-5" }));
    expect(props.onInspect).toHaveBeenLastCalledWith("A_1", ["row-5"]);
    await user.click(screen.getByRole("button", { name: "Inspect complete history of A_1" }));
    expect(props.onInspect).toHaveBeenLastCalledWith("A_1", ["row-1", "row-2", "row-5", "row-3", "row-4", "row-6"]);
    await user.click(screen.getByText("Item D_1 · unresolved flow · 2 records"));
    const partial = await screen.findByRole("table", { name: "Item D_1 activity operators" });
    expect(within(partial).getByRole("row", { name: /^presence / }).textContent).toContain("1 case presence boolean");
    expect(within(partial).getByRole("row", { name: /^count / }).textContent).toContain("unavailable");
    expect(within(partial).getAllByText("Known matching lower bound: 1 · unknown labels: 1")).toHaveLength(4);
    await user.click(screen.getByText("Item B_1 · unresolved flow · 1 records"));
    const zero = await screen.findByRole("table", { name: "Item B_1 activity operators" });
    expect(within(zero).getByRole("row", { name: /^count / }).textContent).toContain("Recorded absence checked against all records: b-1");
    await user.click(within(zero).getByRole("button", { name: "Inspect count evidence" }));
    expect(props.onInspect).toHaveBeenLastCalledWith("B_1", ["b-1"]);
  });

  it("reviews exact selectors, source fields, value alternatives, fixed bands and explicit historical calibration", async () => {
    const { user, client, props } = setup();
    await distributions();
    const activity = screen.getByRole("textbox", { name: "Exact activity selector" });
    await user.clear(activity); await user.type(activity, "Change Price{enter}Change Quantity{enter}Change Price");
    await user.selectOptions(screen.getByRole("combobox", { name: "Activity operator" }), "repeat_quantity");
    const source = screen.getByRole("textbox", { name: "Source activity selector" });
    await user.clear(source); await user.type(source, "Record Goods Receipt{enter}Record Service Entry Sheet");
    await user.selectOptions(screen.getByRole("combobox", { name: "Actor source field" }), "5");
    await user.selectOptions(screen.getByRole("combobox", { name: "Amount source field" }), "4");
    await user.selectOptions(screen.getByRole("combobox", { name: "Item-value reducer" }), "unique_creation_event");
    const unit = screen.getByRole("textbox", { name: "Declared source amount unit" }); await user.clear(unit); await user.type(unit, "anonymized EUR");
    await user.type(screen.getByRole("textbox", { name: "Fixed value-band boundaries (comma separated)" }), "10, 20");
    await user.selectOptions(screen.getByRole("combobox", { name: "Sequence representation" }), "exact");
    await user.selectOptions(screen.getByRole("combobox", { name: "Measurement recipe" }), "historical_v1");
    await user.selectOptions(screen.getByRole("combobox", { name: "Exposure calibration population" }), "selected");
    expect(props.onValidityChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: "Keep positive items" }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Review and read measures" }));
    expect(vi.mocked(client.measures).mock.calls[1][0].query).toMatchObject({ measure_profile: "historical_v1", calibration_population: "selected", roles: { ...measuresRoles, resource: 5, value: 4, net_worth: 4 },
      activity_selector: ["Change Price", "Change Quantity", "Change Price"], activity_operator: "repeat_quantity", interval_source: ["Record Goods Receipt", "Record Service Entry Sheet"], interval_target: ["Clear Invoice"],
      interval_policy: "independent_minimum", value_reducer: "unique_creation_event", value_unit: "anonymized EUR", value_band_edges: [10, 20], representation_policy: "exact" });
    expect(await screen.findByText(/raw P95 38 source_units · divisor 38/)).toBeTruthy();
    expect(screen.getByText(/Interpolation: linear · position/).textContent).toContain("3.8");
    await waitFor(() => expect(props.onValidityChange).toHaveBeenLastCalledWith(true));
  });

  it("pauses a reviewed answer for invalid draft edits and restores the original definition without recomputation", async () => {
    const { user, client, props } = setup();
    await distributions();
    await user.type(screen.getByRole("textbox", { name: "Fixed value-band boundaries (comma separated)" }), "x");
    expect(screen.getByRole("alert").textContent).toContain("finite numbers");
    expect(screen.getByRole("button", { name: "Review and read measures" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Inspect positive item" }).hasAttribute("disabled")).toBe(true);
    expect(props.onValidityChange).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole("button", { name: "Restore reviewed definition" }));
    expect(vi.mocked(client.measures)).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Inspect positive item" }).hasAttribute("disabled")).toBe(false);
    await waitFor(() => expect(props.onValidityChange).toHaveBeenLastCalledWith(true));
  });

  it.each(["success", "error"])("fences a delayed %s when the frozen population revision changes", async outcome => {
    let release: ((outcome: Bpic19MeasuresOutcome) => void) | undefined;
    const client: Bpic19MeasuresClient = { measures: vi.fn((request: Bpic19MeasuresRequest): Promise<Bpic19MeasuresOutcome> => request.query_revision === 2
      ? new Promise<Bpic19MeasuresOutcome>(resolve => { release = resolve; }) : Promise.resolve(answering(request))) };
    const { rerender, props } = setup(client);
    const old = vi.mocked(client.measures).mock.calls[0][0];
    rerender(<Bpic19Measures {...props} revision={3} />);
    await distributions();
    await act(async () => { release?.(outcome === "success" ? answering(old) : { ok: false, problem: { kind: "unreachable" } }); });
    expect(props.onReviewed).toHaveBeenCalledTimes(1);
    expect(props.onReviewed.mock.calls[0][0].query_revision).toBe(3);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("cancels an in-flight request and ignores its publication after reviewing the next draft", async () => {
    let release: ((outcome: Bpic19MeasuresOutcome) => void) | undefined;
    const client: Bpic19MeasuresClient = { measures: vi.fn((request: Bpic19MeasuresRequest): Promise<Bpic19MeasuresOutcome> => release
      ? Promise.resolve(answering(request)) : new Promise(resolve => { release = resolve; })) };
    const { user, props } = setup(client);
    const old = vi.mocked(client.measures).mock.calls[0];
    await user.click(screen.getByRole("button", { name: "Cancel measure request" }));
    expect(old[1].aborted).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("cancelled");
    await user.selectOptions(screen.getByRole("combobox", { name: "Activity operator" }), "presence");
    await user.click(screen.getByRole("button", { name: "Review and read measures" }));
    await distributions();
    await act(async () => { release?.(answering(old[0])); });
    expect(props.onReviewed).toHaveBeenCalledTimes(1);
    expect(props.onReviewed.mock.calls[0][0].query.activity_operator).toBe("presence");
  });

  it("prevents an old page from publishing after an unreviewed role edit", async () => {
    let release: ((outcome: Bpic19MeasuresOutcome) => void) | undefined;
    const client: Bpic19MeasuresClient = { measures: vi.fn((request: Bpic19MeasuresRequest): Promise<Bpic19MeasuresOutcome> => {
      if (request.query.offset > 0) return new Promise(resolve => { release = resolve; });
      const answer = measuresAnswer(request); answer.next_offset = 20;
      return Promise.resolve({ ok: true, answer });
    }) };
    const { user, props } = setup(client); await distributions();
    await user.click(screen.getByRole("button", { name: "Next items" }));
    const page = vi.mocked(client.measures).mock.calls[1];
    await user.selectOptions(screen.getByRole("combobox", { name: "Actor source field" }), "");
    expect(page[1].aborted).toBe(true);
    await act(async () => { release?.(answering(page[0])); });
    expect(props.onReviewed).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Showing 1–3 of 3 items/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep positive items" }).hasAttribute("disabled")).toBe(true);
    expect(props.onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it("retains a failed definition visibly and retries that exact reviewed request", async () => {
    let calls = 0;
    const client: Bpic19MeasuresClient = { measures: vi.fn(async (request: Bpic19MeasuresRequest): Promise<Bpic19MeasuresOutcome> => ++calls === 2 ? { ok: false, problem: { kind: "unreachable" } } : answering(request)) };
    const { user, props } = setup(client); await distributions();
    await user.selectOptions(screen.getByRole("combobox", { name: "Activity operator" }), "repeat_quantity");
    await user.click(screen.getByRole("button", { name: "Review and read measures" }));
    expect((await screen.findByRole("alert")).textContent).toContain("local service could not be reached");
    expect(screen.getByRole("button", { name: "Keep positive items" }).hasAttribute("disabled")).toBe(true);
    expect(props.onValidityChange).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole("button", { name: "Retry measures" }));
    await waitFor(() => expect(props.onReviewed).toHaveBeenCalledTimes(2));
    expect(vi.mocked(client.measures).mock.calls[2][0].query).toEqual(vi.mocked(client.measures).mock.calls[1][0].query);
  });

  it("keeps an empty population distinct from a failed or known-zero result", async () => {
    const client: Bpic19MeasuresClient = { measures: vi.fn(async (request: Bpic19MeasuresRequest): Promise<Bpic19MeasuresOutcome> => {
      const answer = measuresAnswer(request); answer.cases = []; answer.population_case_count = 0; answer.population_record_count = 0;
      answer.activity_cohorts = { positive_case_ids: [], zero_case_ids: [], unavailable_case_ids: [], presence_positive_case_ids: [], presence_absent_case_ids: [], presence_unknown_case_ids: [],
        repeated_positive_case_ids: [], repeated_absent_case_ids: [], repeated_unknown_case_ids: [], population_case_count: 0, denominator: 0, presence_fraction: null, repeated_presence_fraction: null, reason: "empty_denominator" };
      answer.representation_groups = { exact: [], first_occurrence: [] }; answer.representation_unavailable_case_ids = [];
      return { ok: true, answer };
    }) };
    setup(client); await distributions();
    expect(screen.getByText(/No PO items in this population/)).toBeTruthy();
    expect(screen.getByText(/Presence-positive share: unavailable · empty denominator/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep known zero items" }).hasAttribute("disabled")).toBe(true);
  });

  it("requires proposed source roles to be explicitly reviewed before publishing a usable answer", async () => {
    let calls = 0;
    const client: Bpic19MeasuresClient = { measures: vi.fn(async (request: Bpic19MeasuresRequest): Promise<Bpic19MeasuresOutcome> => {
      const answer = measuresAnswer(request);
      if (++calls === 1) { answer.roles_proposed_from_headers = true; answer.definition.roles = measuresRoles; }
      return { ok: true, answer };
    }) };
    const { user, props } = setup(client); await distributions();
    expect(screen.getByRole("alert").textContent).toContain("proposed from headers");
    expect(props.onReviewed).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Keep positive items" }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Review and read measures" }));
    await waitFor(() => expect(props.onReviewed).toHaveBeenCalledTimes(1));
    expect(vi.mocked(client.measures).mock.calls[1][0].query.roles).toEqual(measuresRoles);
    expect(props.onValidityChange).toHaveBeenLastCalledWith(true);
  });

  it("uses supplied fixed-band membership for tied items and keeps unavailable values outside bands", async () => {
    const client: Bpic19MeasuresClient = { measures: vi.fn(async (request: Bpic19MeasuresRequest): Promise<Bpic19MeasuresOutcome> => {
      const answer = measuresAnswer(request);
      answer.value_bands = [{ band_index: 0, lower_inclusive: null, upper_exclusive: 10, case_ids: [] },
        { band_index: 1, lower_inclusive: 10, upper_exclusive: 20, case_ids: ["tie-1", "tie-2", "tie-3"] },
        { band_index: 2, lower_inclusive: 20, upper_exclusive: null, case_ids: [] }];
      answer.value_band_unavailable_case_ids = ["missing-value"];
      return { ok: true, answer };
    }) };
    const { user, props } = setup(client);
    const table = await screen.findByRole("table", { name: "Reviewed fixed value bands · tied values stay together" });
    expect(within(table).getByRole("row", { name: /\[10, 20\)/ }).textContent).toContain("3");
    await user.click(within(table).getByRole("button", { name: "Keep value band 1" }));
    expect(props.onKeepCases).toHaveBeenCalledWith(["tie-1", "tie-2", "tie-3"], "Fixed value band 1");
    expect(screen.getByText("1 items have unavailable values and remain outside finite bands.")).toBeTruthy();
  });
});
