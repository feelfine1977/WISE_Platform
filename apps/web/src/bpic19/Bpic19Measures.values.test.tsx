import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Bpic19MeasuresAnswer, Bpic19MeasuresRequest } from "../generated/bpic19-measures";
import publicAnswer from "./t09-values-answer.json";
import { Bpic19Measures } from "./Bpic19Measures";
import type { Bpic19MeasuresClient, Bpic19MeasuresOutcome } from "./measures-client";

// #111 in the browser over the service's own answer for the literal amount cells. The HTTP test
// test_issue111_item_values_tcp.py requires its live answer to equal this file and asserts every value below.
const frozen = publicAnswer as unknown as Omit<Bpic19MeasuresAnswer, "request_id" | "query_revision" | "workspace_id">;
const feature = (caseId: string) => frozen.cases.find(entry => entry.case_id === caseId)!;

function setup() {
  const client: Bpic19MeasuresClient = { measures: vi.fn(async (request: Bpic19MeasuresRequest): Promise<Bpic19MeasuresOutcome> =>
    JSON.stringify(request.query) === JSON.stringify(frozen.query)
      ? { ok: true, answer: { ...structuredClone(frozen), request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id } as Bpic19MeasuresAnswer }
      : { ok: false, problem: { kind: "refusal", refusal: { schema_version: 1, message_type: "bpic19_measures_refusal", request_id: request.request_id,
          query_revision: request.query_revision, workspace_id: request.workspace_id, operation: "bpic19_measures", code: "unsupported_definition",
          message: "Value band boundaries must be finite and strictly increasing.", field: "query.value_band_edges", retryable: false } } }) };
  const props = { onInspect: vi.fn(), onKeepCases: vi.fn(), onReviewed: vi.fn(), onValidityChange: vi.fn() };
  render(<Bpic19Measures workspaceId="workspace.v1:t09-literal" identity={frozen.identity} revision={1} roles={frozen.query.roles!} query={frozen.query} client={client} {...props} />);
  return { ...props, user: userEvent.setup() };
}
const bands = () => screen.findByRole("table", { name: "Reviewed fixed value bands · tied values stay together" });

describe("#111 item values over the public literal answer", () => {
  it("E01/T09-AC10: keeps the three tied items together in the middle band", async () => {
    setup();
    const rows = within(await bands()).getAllByRole("row").slice(1).map(row => within(row).getAllByRole("cell")[0].textContent);
    expect(rows).toEqual(["2", "3", "1"]);
    expect(frozen.value_bands.map(band => band.case_ids)).toEqual([["N", "Z"], ["B1", "B2", "B3"], ["P"]]);
  });

  it("T09-AC06/AC13/E06: shows conflicting and non-finite amount cells as recorded and opens each by keyboard", async () => {
    const { user, onInspect } = setup();
    await bands();
    await user.click(screen.getByText(/^Item C · /));
    const amounts = screen.getByRole("table", { name: "Item C original amount values" });
    expect(within(amounts).getAllByRole("code").map(code => code.textContent)).toEqual(['"10"', '"20"']);
    const second = feature("C").amount_records[1].row_id;
    within(amounts).getByRole("button", { name: `Inspect amount record ${second}` }).focus();
    await user.keyboard("{Enter}");
    expect(onInspect).toHaveBeenLastCalledWith("C", [second]);
    screen.getByRole("button", { name: "Inspect complete history of C" }).focus();
    await user.keyboard("{Enter}");
    expect(onInspect).toHaveBeenLastCalledWith("C", feature("C").record_row_ids);
    await user.click(screen.getByText(/^Item X2 · /));
    const infinite = screen.getByRole("table", { name: "Item X2 original amount values" });
    expect(within(infinite).getByRole("code").textContent).toBe('"Infinity"');
    expect(within(infinite).getAllByRole("row")[1].textContent).toContain("invalid nonfinite");
  });

  it("E02: a refused band definition names its field and keeps the earlier answer visible but paused", async () => {
    const { user, onKeepCases } = setup();
    await bands();
    await user.selectOptions(screen.getByRole("combobox", { name: "Activity operator" }), "presence");
    await user.click(screen.getByRole("button", { name: "Review and read measures" }));
    expect((await screen.findByRole("alert")).textContent).toContain("(unsupported_definition · query.value_band_edges)");
    const table = await bands();
    const keep = within(table).getAllByRole("button")[0];
    expect(keep.hasAttribute("disabled")).toBe(true);
    await user.click(keep);
    expect(onKeepCases).not.toHaveBeenCalled();
  });
});
