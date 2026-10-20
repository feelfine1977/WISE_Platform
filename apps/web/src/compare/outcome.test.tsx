import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { GroupComparisonRequest } from "../generated/comparison";
import type { OutcomeRatesAnswer, OutcomeRatesRequest } from "../generated/outcome";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { groupAnswer } from "../test/comparisons";
import { evidenceAnswer, identity, populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { scriptedSelectionClient } from "../test/selections";
import { outcomeContract, type OutcomeClient, type OutcomeOutcome } from "./outcomeClient";
import { liftText, OutcomeSection, outcomeName } from "./OutcomeSection";

const request: GroupComparisonRequest = {
  schema_version: 1, message_type: "compare_groups_request", request_id: "compare-1", query_revision: 1, workspace_id: workspaceId, identity,
  parent_case_ids: null, context_column_index: 3, context_policy: "incident.context.first_record_in_declared_order.v1",
  definition: { mode: "selection_partition", target_name: "Recorded “Resolved”", reference_name: "No recorded “Resolved”", predicates: [{ kind: "contains_activity", activity: "Resolved", negate: false }], target_side: "kept" },
};

function rates(asked: OutcomeRatesRequest, unavailable = false): OutcomeRatesAnswer {
  const app = { value: "App", case_count: 4, known_case_count: 4, counted_case_ids: ["C-9", "C-10"], other_case_ids: ["C-4", "C-5"], rate: 0.5, lift: { status: "available" as const, value: 1.2 } };
  return {
    schema_version: 1, message_type: "outcome_rates_answer", request_id: asked.request_id, query_revision: asked.query_revision, workspace_id: asked.workspace_id,
    identity: asked.identity, context_column_index: asked.context_column_index, context_policy: asked.context_policy, outcome: asked.outcome,
    status: unavailable ? "unavailable" : "available", reason: unavailable ? "activity_never_recorded" : null, snapshot_cutoff: "2026-10-02T00:00:00Z",
    parent_case_count: 12, known_case_count: unavailable ? 0 : 12, unknown_case_count: unavailable ? 12 : 0, counted_case_count: unavailable ? 0 : 5,
    rate: unavailable ? null : 5 / 12, context_unevaluable_case_count: 0,
    categories: unavailable ? [] : [app, { value: null, case_count: 0, known_case_count: 0, counted_case_ids: [], other_case_ids: [], rate: null, lift: { status: "unavailable", reason: "empty_category" } }],
  };
}

async function opened() {
  const imports = scriptedImportClient();
  const investigation = new ImportedInvestigationCoordinator(imports.client, scriptedSelectionClient().client);
  investigation.open({ workspaceId, preparationId });
  imports.populations[0].reply({ ok: true, answer: populationAnswer(imports.populations[0].request) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const calls: { request: OutcomeRatesRequest; reply: (outcome: OutcomeOutcome) => void }[] = [];
  const client: OutcomeClient = { rates: (asked) => new Promise((reply) => calls.push({ request: asked, reply })) };
  return { imports, investigation, calls, client };
}

describe("#16 a separately named outcome over the parent", () => {
  it("names the outcome as recorded, gives its known subset and the value's lift apart from the profile ratio, and opens witnesses", async () => {
    const { imports, investigation, calls, client } = await opened();
    const answer = groupAnswer(request);
    render(<OutcomeSection answer={answer} columnName="assignment_group" activities={["Opened", "Resolved"]} investigation={investigation} client={client} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show the outcome by value" }));
    expect(calls).toHaveLength(1);
    const asked = calls[0].request;
    expect(outcomeContract.request(asked)).toBe(true);
    // Asked in the comparison's parent: neither group nor their roles change it.
    expect(asked.identity).toEqual(answer.parent_identity);
    expect(asked.outcome).toEqual({ policy: "incident.outcome.recorded_activity_presence_at_snapshot.v1", activity: "Resolved", counted: "absence" });
    await act(async () => calls[0].reply({ ok: true, answer: rates(asked) }));
    const section = screen.getByRole("region", { name: "Outcome by opening value" });
    expect(section.textContent).toContain("Outcome O: No recorded “Resolved” at the snapshot cutoff 2026-10-02 00:00:00 UTC. Known for 12 incidents of the 12 incidents of the parent (K = P)");
    expect(section.textContent).toContain("it is not a verdict that the incident is unresolved or open");
    expect(section.textContent).toContain("It is not the ratio of shares above");
    const table = within(section).getByRole("table", { name: "No recorded “Resolved” by the first recorded assignment_group" });
    const app = within(table).getByRole("row", { name: /^App/ });
    expect(app.textContent).toContain("2 of 4 (50.0%)");
    expect(app.textContent).toContain("1.20");
    await user.click(within(app).getByRole("button", { name: "Witnesses with O for App" }));
    const witnesses = within(section).getByRole("list", { name: "Witnesses for App" });
    expect(within(witnesses).getAllByRole("listitem").map((item) => item.textContent?.split(" ")[0])).toEqual(["C-9", "C-10"]);
    await user.click(within(witnesses).getByRole("button", { name: "Open C-10" }));
    const call = imports.evidence.at(-1)!;
    expect(call.request.identity).toEqual(answer.parent_identity);
    await act(async () => call.reply({ ok: true, answer: evidenceAnswer(call.request) }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole("list", { name: "Witnesses for App" })).getByRole("button", { name: "Open C-10" })));
    // The same parent, value list and outcome stay after returning.
    expect(screen.getByRole("table", { name: "No recorded “Resolved” by the first recorded assignment_group" })).toBeTruthy();
  });

  it("names no outcome for an activity no record carries, and drops a late reply", async () => {
    const { investigation, calls, client } = await opened();
    render(<OutcomeSection answer={groupAnswer(request)} columnName="assignment_group" activities={["Closed", "Resolved"]} investigation={investigation} client={client} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show the outcome by value" }));
    await user.selectOptions(screen.getByLabelText("Activity of the outcome"), "Closed");
    await user.click(screen.getByRole("button", { name: "Show the outcome by value" }));
    await act(async () => calls[1].reply({ ok: true, answer: rates(calls[1].request, true) }));
    await act(async () => calls[0].reply({ ok: true, answer: rates(calls[0].request) }));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("note").textContent).toContain("No record of “Closed” is in this source, so it names no outcome");
    expect(screen.getByRole("note").textContent).toContain("have an unknown outcome, not a favourable or an unfavourable one");
  });

  it("words the outcome and its lift", () => {
    expect([outcomeName("Resolved", "absence"), outcomeName("Resolved", "presence")]).toEqual(["No recorded “Resolved”", "Recorded “Resolved”"]);
    expect(liftText({ status: "unavailable", reason: "zero_parent_rate" })).toBe("not available: the parent's rate is 0");
  });
});
