import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StageProposalAnswer, StageProposalRequest } from "../generated/stage-proposal";
import type { UnansweredRequestsAnswer, UnansweredRequestsRequest } from "../generated/unanswered-requests";
import type { ProposalClient, ProposalOutcome } from "../stages/proposalClient";
import { identity, preparationId, workspaceId } from "../test/imports";
import type { RequestsClient, RequestsOutcome } from "./client";
import { requestsContract } from "./client";
import { definitionWords, draftProblem, emptyDraft, fromPresentation, RequestsStore, toPresentation } from "./definitions";
import { RequestsPanel } from "./RequestsPanel";

const reading = { workspaceId, preparationId };
const memory = () => { const kept = new Map<string, string>(); return { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) }; };
const turnColumn = (index: number) => (index === 4 ? "Turn" : `column ${index}`);

describe("the definition of requests and answers", () => {
  it("is said in words, refused while incomplete or contradictory, and asks for a new review after any change", () => {
    expect(draftProblem(emptyDraft)).toBe("Choose at least one request activity.");
    const draft = { requests: ["Asked customer"], answers: ["Customer replied"], turn: { column: 4, value: "Customer" }, gapHours: 72, reviewed: false };
    expect(draftProblem(draft)).toBeNull();
    expect(draftProblem({ ...draft, answers: ["Asked customer"] })).toBe("“Asked customer” cannot be both a request and an answer.");
    expect(definitionWords(draft, turnColumn)).toBe(
      "A request is a record of “Asked customer” recorded while Turn is “Customer”; an answer is a record of “Customer replied”. A record more than 72 hours after " +
        "the record before it starts a new matter, and only the latest matter of an incident is read. An incident is listed when its last request in that matter has no later answer in the records of the export.",
    );
    const store = new RequestsStore(memory());
    // A review is given to the definition as it stands: given together with a new meaning it is not taken.
    store.change(reading, () => ({ ...draft, reviewed: true }));
    expect(store.stateOf(reading).draft.reviewed).toBe(false);
    store.change(reading, (current) => ({ ...current, reviewed: true }));
    expect(store.stateOf(reading).draft.reviewed).toBe(true);
    store.change(reading, (current) => ({ ...current, gapHours: 48 }));
    expect(store.stateOf(reading).draft.reviewed).toBe(false);
    expect(fromPresentation(toPresentation({ ...draft, reviewed: true }, preparationId))).toEqual({ ...draft, reviewed: true });
  });
});

function answerOf(request: UnansweredRequestsRequest): UnansweredRequestsAnswer {
  return {
    schema_version: 1, message_type: "unanswered_requests_answer", request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id,
    identity: request.identity, policy: "incident.request.last_unanswered.v1", definition: request.definition,
    clock: { timestamp_kind: "utc_instant", snapshot_cutoff: "2026-10-20T00:00:00Z" }, kept_case_count: 7,
    outcomes: { without_answer: 2, answered: 1, no_request: 3, order_unknown: 1 }, order_unknown_case_ids: ["R-7"],
    cases: [
      { case_id: "R-2", last_request: { row_id: "row:6", position: 2, activity: "Asked customer", time: "2026-10-10T10:00:00Z" }, records_after_request: 0,
        matter_record_count: 2, record_count: 2, last_record_time: "2026-10-10T10:00:00Z", hours_since_last_record: 230 },
      { case_id: "R-3", last_request: { row_id: "row:10", position: 4, activity: "Asked customer", time: "2026-10-12T08:00:00Z" }, records_after_request: 1,
        matter_record_count: 5, record_count: 5, last_record_time: "2026-10-12T09:00:00Z", hours_since_last_record: 183 },
    ],
    cases_truncated: false,
  };
}

function turnValues(request: StageProposalRequest): StageProposalAnswer {
  const item = (activity: string, values: [string, number][]) => ({ activity, record_count: values.reduce((sum, [, n]) => sum + n, 0), incident_count: 1, missing_record_count: 0,
    value_count: values.length, values: values.map(([value, record_count]) => ({ value, record_count })), values_truncated: false, other_record_count: 0, mixed: values.length > 1, leading: null });
  return { schema_version: 1, message_type: "stage_proposal_answer", request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id,
    identity: request.identity, policy: "incident.stage.proposal.every_record_value_counts.v1", column_index: request.column_index, column_name: "Turn",
    kept: { case_count: 7, record_count: 21, labelled_record_count: 21, unlabelled_record_count: 0 },
    activities: [item("Opened", [["Agent", 8]]), item("Asked customer", [["Customer", 6], ["Agent", 1]]), item("Customer replied", [["Agent", 2]])] };
}

describe("requests without a later answer beside the investigation", () => {
  let asked: UnansweredRequestsRequest[], replies: ((outcome: RequestsOutcome) => void)[], proposals: ((outcome: ProposalOutcome) => void)[], proposed: StageProposalRequest[];
  let signals: AbortSignal[], proposalSignals: AbortSignal[];
  beforeEach(() => { asked = []; replies = []; proposals = []; proposed = []; signals = []; proposalSignals = []; });
  const client: RequestsClient = { unanswered: (request, signal) => new Promise((reply) => { asked.push(request); replies.push(reply); signals.push(signal); }) };
  const proposalClient: ProposalClient = { propose: (request, signal) => new Promise((reply) => { proposed.push(request); proposals.push(reply); proposalSignals.push(signal); }) };

  it.each(["success", "failure"])("discards an obsolete %s after the reviewed definition is edited", async (replyKind) => {
    const store = new RequestsStore(memory());
    store.change(reading, () => ({ ...emptyDraft, requests: ["Asked customer"], answers: ["Customer replied"] }));
    store.change(reading, (current) => ({ ...current, reviewed: true }));
    const user = userEvent.setup();
    render(<RequestsPanel workspaceId={workspaceId} preparationId={preparationId} identity={identity} revision={2} activities={["Asked customer", "Customer replied"]}
      columns={[{ index: 4, name: "Turn" }]} onOpenCase={vi.fn()} openCaseId={null} client={client} proposalClient={proposalClient} store={store} />);

    await user.click(screen.getByRole("button", { name: "Find the incidents" }));
    expect(asked).toHaveLength(1);
    await user.type(screen.getByLabelText(/starts a new matter after a gap/), "48");
    await act(async () => replies[0](replyKind === "success" ? { ok: true, answer: answerOf(asked[0]) } : { ok: false, problem: { kind: "unreachable" } }));
    expect(screen.queryByRole("table", { name: "Incidents whose last request has no later answer" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(signals[0].aborted).toBe(true);

    // Reviewing the edited meaning permits a new request; it does not issue one by itself.
    await user.click(screen.getByRole("checkbox", { name: /I have reviewed this definition/ }));
    expect(asked).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Find the incidents" }));
    expect(asked).toHaveLength(2);
    expect(asked[1].definition.gap_hours).toBe(48);
    await act(async () => replies[1]({ ok: true, answer: answerOf(asked[1]) }));
    expect(screen.getByRole("table", { name: "Incidents whose last request has no later answer" })).toBeTruthy();
  });

  it.each(["success", "failure"])("discards obsolete turn-column %s without replacing the current values", async (replyKind) => {
    const store = new RequestsStore(memory());
    const user = userEvent.setup();
    render(<RequestsPanel workspaceId={workspaceId} preparationId={preparationId} identity={identity} revision={2} activities={["Asked customer", "Customer replied"]}
      columns={[{ index: 4, name: "Turn" }, { index: 5, name: "Desk" }]} onOpenCase={vi.fn()} openCaseId={null} client={client} proposalClient={proposalClient} store={store} />);

    await user.selectOptions(screen.getByLabelText("Turn column"), "4");
    await user.click(screen.getByRole("button", { name: "Read the values of this column" }));
    await user.selectOptions(screen.getByLabelText("Turn column"), "5");
    await user.click(screen.getByRole("button", { name: "Read the values of this column" }));
    const current = turnValues(proposed[1]);
    current.activities = [{ ...current.activities[0], activity: "Asked customer", values: [{ value: "Current desk", record_count: 8 }] }];
    await act(async () => proposals[1]({ ok: true, answer: current }));
    await act(async () => proposals[0](replyKind === "success" ? { ok: true, answer: turnValues(proposed[0]) } : { ok: false, problem: { kind: "unreachable" } }));
    expect(screen.getByRole("option", { name: "Current desk" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Customer" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(proposalSignals[0].aborted).toBe(true);
    await user.selectOptions(screen.getByLabelText(/A request counts while the turn is/), "Current desk");
    expect(store.stateOf(reading).draft.turn).toEqual({ column: 5, value: "Current desk" });
  });

  it("does not propose activities from another column that happens to contain the same value", async () => {
    const store = new RequestsStore(memory());
    store.change(reading, () => ({ ...emptyDraft, turn: { column: 4, value: "Customer" } }));
    const user = userEvent.setup();
    render(<RequestsPanel workspaceId={workspaceId} preparationId={preparationId} identity={identity} revision={2} activities={["Asked customer", "Customer replied"]}
      columns={[{ index: 4, name: "Turn" }, { index: 5, name: "Desk" }]} onOpenCase={vi.fn()} openCaseId={null} client={client} proposalClient={proposalClient} store={store} />);
    await user.selectOptions(screen.getByLabelText("Turn column"), "5");
    await user.click(screen.getByRole("button", { name: "Read the values of this column" }));
    await act(async () => proposals[0]({ ok: true, answer: turnValues(proposed[0]) }));
    expect(screen.getByRole("option", { name: "Customer" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use the proposal as the request activities" })).toBeNull();
    await user.selectOptions(screen.getByLabelText(/A request counts while the turn is/), "Customer");
    expect(screen.getByText(/activities recorded while Desk is “Customer”/)).toBeTruthy();
  });

  it("fences an earlier read of the same column and aborts on leaving the panel", async () => {
    const store = new RequestsStore(memory());
    const user = userEvent.setup();
    const { unmount } = render(<RequestsPanel workspaceId={workspaceId} preparationId={preparationId} identity={identity} revision={2} activities={["Asked customer", "Customer replied"]}
      columns={[{ index: 4, name: "Turn" }]} onOpenCase={vi.fn()} openCaseId={null} client={client} proposalClient={proposalClient} store={store} />);
    await user.selectOptions(screen.getByLabelText("Turn column"), "4");
    await user.click(screen.getByRole("button", { name: "Read the values of this column" }));
    await user.click(screen.getByRole("button", { name: "Read the values of this column" }));
    await act(async () => proposals[1]({ ok: true, answer: turnValues(proposed[1]) }));
    await act(async () => proposals[0]({ ok: false, problem: { kind: "unreachable" } }));
    expect(screen.getByRole("option", { name: "Customer" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(proposalSignals[0].aborted).toBe(true);
    unmount();
    expect(proposalSignals[1].aborted).toBe(true);
  });

  it("proposes the request activities from the observed turn values, reads a reviewed definition only, and opens the evidence", async () => {
    const onOpenCase = vi.fn();
    const store = new RequestsStore(memory());
    const user = userEvent.setup();
    render(<RequestsPanel workspaceId={workspaceId} preparationId={preparationId} identity={identity} revision={2} activities={["Opened", "Asked customer", "Customer replied", "Note added"]}
      columns={[{ index: 4, name: "Turn" }]} onOpenCase={onOpenCase} openCaseId={null} client={client} proposalClient={proposalClient} store={store} />);
    const find = screen.getByRole("button", { name: "Find the incidents" });
    expect((find as HTMLButtonElement).disabled).toBe(true);

    // The proposal from the observed values of the turn column, used, then the answer chosen and the definition reviewed.
    await user.selectOptions(screen.getByLabelText("Turn column"), "4");
    await user.click(screen.getByRole("button", { name: "Read the values of this column" }));
    await act(async () => proposals[0]({ ok: true, answer: turnValues(proposed[0]) }));
    await user.selectOptions(screen.getByLabelText(/A request counts while the turn is/), "Customer");
    expect(screen.getByText(/Proposed from the observed values: the activities recorded while Turn is “Customer” — “Asked customer” \(6 of 7 records\)/)).toBeTruthy();
    expect(store.stateOf(reading).draft.requests).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Use the proposal as the request activities" }));
    await user.click(within(screen.getByRole("group", { name: "Answer activities" })).getByRole("checkbox", { name: "Customer replied" }));
    await user.type(screen.getByLabelText(/starts a new matter after a gap/), "72");
    expect((find as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: /I have reviewed this definition/ }));
    await user.click(find);
    expect(asked).toHaveLength(1);
    expect(requestsContract.request(asked[0])).toBe(true);
    expect(asked[0].definition).toEqual({ request_activities: ["Asked customer"], answer_activities: ["Customer replied"], turn: { column_index: 4, value: "Customer" }, gap_hours: 72 });
    const answer = answerOf(asked[0]);
    expect(requestsContract.answer(answer)).toBe(true);
    await act(async () => replies[0]({ ok: true, answer }));

    const outcomes = screen.getByLabelText("Kept incidents by their last request").textContent;
    expect(outcomes).toContain("Last request without a later answer2 incidents");
    expect(outcomes).toContain("Order of records not known, not read1 incident");
    expect(screen.getByText(/to the export cutoff accepted at import, 2026-10-20 00:00 UTC: how long the export holds no further record of the incident\. It is not a waiting time/)).toBeTruthy();
    const rows = within(screen.getByRole("table", { name: "Incidents whose last request has no later answer" })).getAllByRole("row").slice(1).map((row) => row.textContent);
    expect(rows[0]).toContain("“Asked customer”, record 2, 2026-10-10 10:00 UTC");
    // The outcomes and the evidence name no resolution: only what the export recorded.
    expect(`${outcomes} ${rows.join(" ")}`).not.toMatch(/resolv|rate|clos/i);
    await user.click(screen.getByRole("button", { name: "Open R-3 with its last request marked" }));
    expect(onOpenCase).toHaveBeenCalledWith("R-3", ["row:10"]);

    // A changed definition asks for a new review, and the earlier answer is no longer shown as its answer.
    await user.clear(screen.getByLabelText(/starts a new matter after a gap/));
    expect(store.stateOf(reading).draft.reviewed).toBe(false);
    expect(screen.queryByRole("table", { name: "Incidents whose last request has no later answer" })).toBeNull();
  });
});
