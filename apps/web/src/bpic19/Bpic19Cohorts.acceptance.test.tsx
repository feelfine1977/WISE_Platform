import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Bpic19CohortsAnswer, Bpic19CohortsRequest } from "../generated/bpic19-cohorts";
import publicAnswer from "./t06-cohorts-answer.json";
import { Bpic19Cohorts } from "./Bpic19Cohorts";
import type { CohortsClient, CohortsOutcome } from "./cohorts-client";

// #108 in the browser over the service's own answer for the literal M–Q source. The HTTP test
// test_issue108_completion_cohorts_tcp.py requires its live answer to equal this file and asserts the values below.
const frozen = publicAnswer as unknown as Omit<Bpic19CohortsAnswer, "request_id" | "query_revision" | "workspace_id">;
const item = (caseId: string) => frozen.cohorts.page.items.find(entry => entry.case_id === caseId)!;

function setup() {
  const client: CohortsClient = { cohorts: vi.fn(async (request: Bpic19CohortsRequest): Promise<CohortsOutcome> =>
    JSON.stringify(request.query) === JSON.stringify(frozen.query)
      ? { ok: true, answer: { ...structuredClone(frozen), request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id } as Bpic19CohortsAnswer }
      : { ok: false, problem: { kind: "refusal", refusal: { schema_version: 1, message_type: "bpic19_cohorts_refusal", request_id: request.request_id,
          query_revision: request.query_revision, workspace_id: request.workspace_id, operation: "bpic19_cohorts", code: "invalid_parameter",
          message: "Declare the reviewed source of this horizon.", field: "query.horizon.provenance", retryable: false } } }) };
  const props = { onInspect: vi.fn(), onKeepCases: vi.fn(), onKeepSupport: vi.fn(), onReviewed: vi.fn(), onValidityChange: vi.fn() };
  render(<Bpic19Cohorts workspaceId="workspace.v1:t06-literal" identity={frozen.identity} revision={1} roles={frozen.query.roles} timestampKind="wall_clock"
    query={frozen.query} client={client} {...props} />);
  return { ...props, user: userEvent.setup() };
}
const stages = () => screen.findByRole("table", { name: "Whole-item stages and recorded completion" });
const stage = (table: HTMLElement, name: string) => within(table).getByRole("row", { name: new RegExp(`^${name} `) }).textContent ?? "";

describe("#108 completion cohorts over the public literal answer", () => {
  it("E01/T06-AC03: shows both receipt orders closed before GR and retains every item when nothing is excluded", async () => {
    setup();
    const table = await stages();
    expect(stage(table, "Recorded closed")).toContain("3 PO items · 12 original records");
    expect(stage(table, "Recorded open")).toContain("1 PO items · 2 original records");
    expect(stage(table, "Unknown")).toContain("1 PO items · 2 original records");
    expect(stage(table, "Retained for analysis")).toContain("5 PO items · 16 original records");
    expect(stage(table, "Excluded by inclusion")).toContain("0 PO items · 0 original records");
    const evidence = screen.getByRole("table", { name: /^Complete-item evidence/ });
    for (const caseId of ["M", "N"]) expect(within(evidence).getByRole("row", { name: new RegExp(`^${caseId} `) }).textContent).toContain("Recorded closed");
    expect(within(evidence).getByRole("row", { name: /^O / }).textContent).toContain("Recorded open");
    expect(evidence.textContent).not.toContain("Remove Payment Block");
  });

  it("T06-AC12: keeps a recorded-closed stage as a typed step of exactly this answer", async () => {
    const { user, onKeepSupport, onKeepCases } = setup();
    await user.click(within(await stages()).getByRole("button", { name: "Keep Recorded closed" }));
    expect(onKeepSupport).toHaveBeenCalledTimes(1);
    const [kept, support] = onKeepSupport.mock.calls[0];
    expect(support).toBe("observed_closed");
    expect(kept.definition_id).toBe(frozen.definition_id);
    expect(kept.cohorts.completion_groups.find((group: { state: string }) => group.state === "observed_closed").case_ids).toEqual(["M", "N", "P"]);
    expect(onKeepCases).not.toHaveBeenCalled();
  });

  it("E06: keyboard evidence opens each item with exactly its witnessed rows", async () => {
    const { user, onInspect } = setup();
    await stages();
    for (const caseId of ["M", "O", "Q"]) {
      screen.getByRole("button", { name: `Inspect ${caseId}` }).focus();
      await user.keyboard("{Enter}");
      expect(onInspect).toHaveBeenLastCalledWith(caseId, item(caseId).witness_row_ids);
    }
    // M is closed by its Clear Invoice record. O and Q have no such record: their whole history opens, and the
    // reason beside them says why they are open or unknown.
    expect(item("M").witness_row_ids).toHaveLength(1);
    const evidence = screen.getByRole("table", { name: /^Complete-item evidence/ });
    expect(within(evidence).getByRole("row", { name: /^O / }).textContent).toContain("missing_recorded_milestone:Clear Invoice");
    expect(within(evidence).getByRole("row", { name: /^Q / }).textContent).toContain("missing_activity_label");
  });

  it("E02: a refusal names its code and field and keeps the earlier answer visible but paused", async () => {
    const { user, onKeepSupport } = setup();
    await stages();
    await user.click(screen.getByText("Inclusion and completion definition"));
    await user.type(screen.getByRole("textbox", { name: "Declared observation horizon (optional ISO)" }), "2018-06-01T00:00:00");
    await user.click(screen.getByRole("button", { name: "Review this cohort" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Declare the reviewed source of this horizon. (invalid_parameter · query.horizon.provenance)");
    const table = await stages();
    expect(stage(table, "Retained for analysis")).toContain("5 PO items");
    const keep = within(table).getByRole("button", { name: "Keep Recorded closed" });
    expect(keep.hasAttribute("disabled")).toBe(true);
    await user.click(keep);
    expect(onKeepSupport).not.toHaveBeenCalled();
  });
});
