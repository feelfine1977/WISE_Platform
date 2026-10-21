import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Bpic19MeasuresAnswer, Bpic19MeasuresRequest } from "../generated/bpic19-measures";
import publicAnswer from "./t05-measures-answer.json";
import { Bpic19Measures } from "./Bpic19Measures";
import type { Bpic19MeasuresClient, Bpic19MeasuresOutcome } from "./measures-client";

// #107 in the browser over the service's own answer for the literal A–F source. The HTTP test
// test_issue107_activity_measures_tcp.py requires its live answer to equal this file and asserts every value below.
const frozen = publicAnswer as unknown as Omit<Bpic19MeasuresAnswer, "request_id" | "query_revision" | "workspace_id">;
const workspaceId = "workspace.v1:t05-literal";
const records = (caseId: string) => frozen.cases.find(feature => feature.case_id === caseId)!.record_row_ids;

function setup() {
  const client: Bpic19MeasuresClient = { measures: vi.fn(async (request: Bpic19MeasuresRequest): Promise<Bpic19MeasuresOutcome> =>
    JSON.stringify(request.query) === JSON.stringify(frozen.query)
      ? { ok: true, answer: { ...structuredClone(frozen), request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id } as Bpic19MeasuresAnswer }
      : { ok: false, problem: { kind: "refusal", refusal: { schema_version: 1, message_type: "bpic19_measures_refusal", request_id: request.request_id,
          query_revision: request.query_revision, workspace_id: request.workspace_id, operation: "bpic19_measures", code: "role_unavailable",
          message: "Review the activity role before counting.", field: "query.roles.activity", retryable: false } } }) };
  const props = { onInspect: vi.fn(), onKeepCases: vi.fn(), onKeepCohort: vi.fn(), onReviewed: vi.fn(), onValidityChange: vi.fn() };
  render(<Bpic19Measures workspaceId={workspaceId} identity={frozen.identity} revision={1} roles={frozen.query.roles!} query={frozen.query} client={client} {...props} />);
  return { ...props, client, user: userEvent.setup() };
}

async function operators(user: ReturnType<typeof userEvent.setup>, caseId: string, recordCount: number) {
  await user.click(await screen.findByText(`Item ${caseId} · unresolved flow · ${recordCount} records`));
  return screen.findByRole("table", { name: `Item ${caseId} activity operators` });
}
const row = (table: HTMLElement, operator: RegExp) => within(table).getByRole("row", { name: operator }).textContent ?? "";

describe("#107 activity measures over the public literal answer", () => {
  it("E01/T05-AC06: shows exact counts for A and finite indicators for D, E and F without inventing absence", async () => {
    const { user } = setup();
    const a = await operators(user, "A", 6);
    expect(row(a, /^count /)).toContain("2 event occurrences");
    expect(row(a, /^repeated presence /)).toContain("1 case repeated presence boolean");
    const d = await operators(user, "D", 2);
    for (const operator of [/^count /, /^presence /, /^repeat quantity /, /^repeated presence /]) expect(row(d, operator)).toContain("unavailable");
    expect(screen.getAllByText(/Known matches 0 · unknown activity records 1\./).length).toBeGreaterThan(0);
    const e = await operators(user, "E", 2);
    expect(row(e, /^presence /)).toContain("1 case presence boolean");
    expect(row(e, /^count /)).toContain("unavailable");
    expect(row(e, /^repeated presence /)).toContain("unavailable");
    const f = await operators(user, "F", 3);
    expect(row(f, /^repeated presence /)).toContain("1 case repeated presence boolean");
    expect(row(f, /^repeat quantity /)).toContain("unavailable");
    expect(screen.getAllByText(/Known matches 2 · unknown activity records 1\./).length).toBeGreaterThan(0);
  });

  it("T05-AC08/AC10: reports the cohorts over the complete parent and keeps the positive cohort as a typed step", async () => {
    const { user, onKeepCohort, onKeepCases } = setup();
    const cohorts = await screen.findByRole("table", { name: "Reviewed activity operator cohorts · complete items" });
    expect(within(cohorts).getByRole("row", { name: /^Positive / }).textContent).toMatch(/^Positive1/);
    expect(within(cohorts).getByRole("row", { name: /^Known zero / }).textContent).toMatch(/^Known zero2/);
    expect(within(cohorts).getByRole("row", { name: /^Unavailable / }).textContent).toMatch(/^Unavailable3/);
    expect(screen.getByText(/Presence-positive share: 50/).textContent).toContain("complete parent denominator 6");
    await user.click(within(cohorts).getByRole("button", { name: "Keep positive items" }));
    expect(onKeepCohort).toHaveBeenCalledTimes(1);
    const [kept, cohort] = onKeepCohort.mock.calls[0];
    expect(cohort).toBe("positive");
    expect(kept.activity_cohorts.positive_case_ids).toEqual(["A"]);
    expect(kept.definition_id).toBe(frozen.definition_id);
    expect(onKeepCases).not.toHaveBeenCalled();
  });

  it("E06: keyboard evidence opens the complete history and exactly the witnessed rows", async () => {
    const { user, onInspect } = setup();
    const e = await operators(user, "E", 2);
    // E's presence is witnessed by its receipt; its missing-label record is shown beside it, never hidden.
    within(e).getByRole("button", { name: "Inspect presence evidence" }).focus();
    await user.keyboard("{Enter}");
    expect(onInspect).toHaveBeenLastCalledWith("E", records("E"));
    const a = await operators(user, "A", 6);
    within(a).getByRole("button", { name: "Inspect count evidence" }).focus();
    await user.keyboard("{Enter}");
    expect(onInspect).toHaveBeenLastCalledWith("A", records("A").slice(0, 2));
    screen.getByRole("button", { name: "Inspect complete history of A" }).focus();
    await user.keyboard("{Enter}");
    expect(onInspect).toHaveBeenLastCalledWith("A", records("A"));
    expect(records("A")).toHaveLength(6);
  });

  it("E02: a refused definition names its code and field and keeps the earlier answer visible but paused", async () => {
    const { user, onKeepCohort } = setup();
    await screen.findByRole("table", { name: "Reviewed activity operator cohorts · complete items" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Activity operator" }), "presence");
    await user.click(screen.getByRole("button", { name: "Review and read measures" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Review the activity role before counting. (role_unavailable · query.roles.activity)");
    expect(screen.getByRole("table", { name: "Raw-measure distributions over the complete named population" })).toBeTruthy();
    const keep = screen.getByRole("button", { name: "Keep positive items" });
    expect(keep.hasAttribute("disabled")).toBe(true);
    await user.click(keep);
    expect(onKeepCohort).not.toHaveBeenCalled();
  });
});
