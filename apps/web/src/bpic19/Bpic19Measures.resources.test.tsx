import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Bpic19MeasuresAnswer, Bpic19MeasuresRequest } from "../generated/bpic19-measures";
import publicAnswer from "./t08-resource-answer.json";
import { Bpic19Measures } from "./Bpic19Measures";
import type { Bpic19MeasuresClient, Bpic19MeasuresOutcome } from "./measures-client";

// #110 in the browser over the service's own answer for the literal actor cells. The HTTP test
// test_issue110_resource_proxies_tcp.py requires its live answer to equal this file and asserts every value below.
const frozen = publicAnswer as unknown as Omit<Bpic19MeasuresAnswer, "request_id" | "query_revision" | "workspace_id">;
const actorRows = (caseId: string) => frozen.cases.find(feature => feature.case_id === caseId)!.actor_records.map(actor => actor.row_id);

function setup() {
  const client: Bpic19MeasuresClient = { measures: vi.fn(async (request: Bpic19MeasuresRequest): Promise<Bpic19MeasuresOutcome> =>
    JSON.stringify(request.query) === JSON.stringify(frozen.query)
      ? { ok: true, answer: { ...structuredClone(frozen), request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id } as Bpic19MeasuresAnswer }
      : { ok: false, problem: { kind: "refusal", refusal: { schema_version: 1, message_type: "bpic19_measures_refusal", request_id: request.request_id,
          query_revision: request.query_revision, workspace_id: request.workspace_id, operation: "bpic19_measures", code: "invalid_parameter",
          message: "The resource role must name a confirmed column.", field: "query.roles.resource", retryable: false } } }) };
  const props = { onInspect: vi.fn(), onKeepCases: vi.fn(), onReviewed: vi.fn(), onValidityChange: vi.fn() };
  render(<Bpic19Measures workspaceId="workspace.v1:t08-literal" identity={frozen.identity} revision={1} roles={frozen.query.roles!} query={frozen.query} client={client} {...props} />);
  return { ...props, user: userEvent.setup() };
}
const table = () => screen.findByRole("table", { name: "Resource attribution by item" });
const row = (resources: HTMLElement, caseId: string) => within(resources).getByRole("row", { name: new RegExp(`^${caseId} `) });
const cells = (resources: HTMLElement, caseId: string) => within(row(resources, caseId)).getAllByRole("cell").map(cell => cell.textContent).slice(0, 6);

describe("#110 resource attribution over the public literal answer", () => {
  it("E01/T08-AC01–AC05: shows attributed, batch-only and unknown-containing items with their readiness", async () => {
    setup();
    const resources = await table();
    expect(cells(resources, "A")).toEqual(["attributed", "3", "2", "1", "0", "available"]);
    expect(cells(resources, "B")).toEqual(["batch-only", "0", "0", "2", "0", "available"]);
    expect(cells(resources, "C")).toEqual(["attributed", "2", "1", "1", "0", "available"]);
    expect(cells(resources, "D")).toEqual(["unknown-containing", "1", "1", "0", "1", "unavailable · incomplete resource attribution"]);
    expect(cells(resources, "H")).toEqual(["unknown-containing", "1", "1", "1", "5", "unavailable · incomplete resource attribution"]);
    expect(cells(resources, "T")).toEqual(["attributed", "2", "2", "0", "0", "available"]);
  });

  it("T08-AC11/E06: by keyboard, an unknown-containing and a batch-only item open with every actor record, and either can be kept whole", async () => {
    const { user, onInspect, onKeepCases } = setup();
    const resources = await table();
    for (const caseId of ["D", "B"]) {
      within(row(resources, caseId)).getByRole("button", { name: `Inspect actor records of ${caseId}` }).focus();
      await user.keyboard("{Enter}");
      expect(onInspect).toHaveBeenLastCalledWith(caseId, actorRows(caseId));
    }
    within(row(resources, "B")).getByRole("button", { name: "Keep resource item B" }).focus();
    await user.keyboard("{Enter}");
    expect(onKeepCases).toHaveBeenLastCalledWith(["B"], "Resource attribution: B");
  });

  it("T08-AC03/AC08: keeps original cells beside their normalized identities and names each share's denominator", async () => {
    const { user } = setup();
    await table();
    await user.click(screen.getByText(/^Item C · /));
    const c = screen.getByRole("table", { name: "Item C original actor identities" });
    const quoted = within(c).getAllByRole("code").map(code => code.textContent);
    expect(quoted).toEqual(['" USER_1 "', '"user_1"', '" batch_2 "']);
    await user.click(screen.getByText(/^Item K · /));
    expect(screen.getByText(/Batch \/ all records: 0\.2 \(denominator 5\)/)).toBeTruthy();
  });

  it("E02: a refused resource role names its field and keeps the earlier answer visible but paused", async () => {
    const { user, onKeepCases } = setup();
    const resources = await table();
    await user.selectOptions(screen.getByRole("combobox", { name: "Activity operator" }), "presence");
    await user.click(screen.getByRole("button", { name: "Review and read measures" }));
    expect((await screen.findByRole("alert")).textContent).toContain("(invalid_parameter · query.roles.resource)");
    const keep = within(row(resources, "B")).getByRole("button", { name: "Keep resource item B" });
    expect(keep.hasAttribute("disabled")).toBe(true);
    await user.click(keep);
    expect(onKeepCases).not.toHaveBeenCalled();
  });
});
