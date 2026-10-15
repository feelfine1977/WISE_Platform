import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Bpic19Scoring, type Bpic19ScoringSubject } from "./Bpic19Scoring";
import { bpic19Contract, type Bpic19Client, type Bpic19Outcome } from "./scoring-client";
import type { Bpic19ScoreAnswer, Bpic19ScoreRequest } from "./scoring-types";
import fixture from "./scoring-fixtures/native-two-items.json";
function answer(request?: Bpic19ScoreRequest): Bpic19ScoreAnswer {
  const value: unknown = structuredClone(fixture);
  if (!bpic19Contract.answer(value)) throw new Error("The native fixture must satisfy the contract.");
  return request ? { ...value, request_id: request.request_id, query_revision: request.query_revision, report: { ...value.report, settings: { ...value.report.settings, ...request.settings } } } : value;
}
const base = answer();
const subject: Bpic19ScoringSubject = { workspace_id: base.workspace_id, base_identity: base.base_identity,
  named_population: base.named_population, roles: { item_category: 3, resource: 5, net_worth: 7 } };
describe("BPIC19 criterion analysis", () => {
  it("reads a frozen assessment without offering evaluation, edits or current-selection mutations", async () => {
    const reviewed = vi.fn(), valid = vi.fn(), keep = vi.fn();
    const client: Bpic19Client = {
      score: vi.fn(), associate: vi.fn(), review: vi.fn(),
      read: vi.fn<Bpic19Client["read"]>(async request => ({ ok: true, answer: { ...answer(), request_id: request.request_id, query_revision: request.query_revision } })),
    };
    render(<Bpic19Scoring subject={subject} client={client} initialRun={answer()} readOnly
      onReviewed={reviewed} onValidityChange={valid} onKeepCases={keep} />);
    expect(screen.getByText(/Frozen assessment: Balanced/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Run analysis" })).toBeNull();
    expect(screen.queryByLabelText("Stakeholder view")).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep these complete items" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inspect members of A · Parts" }));
    await waitFor(() => expect(client.read).toHaveBeenCalledTimes(1));
    expect(client.read).toHaveBeenCalledWith(expect.objectContaining({run_id: base.run_id, case_filter: {group_values: {company: "A", spend_area: "Parts"}}}), expect.any(AbortSignal));
    expect(client.score).not.toHaveBeenCalled(); expect(client.associate).not.toHaveBeenCalled(); expect(client.review).not.toHaveBeenCalled();
    expect(reviewed).not.toHaveBeenCalled(); expect(valid).not.toHaveBeenCalled(); expect(keep).not.toHaveBeenCalled();
  });
  it("runs the reviewed role recipe and exposes exact raw witness callbacks", async () => {
    const inspect = vi.fn();
    const client: Bpic19Client = { score: vi.fn<Bpic19Client["score"]>(async request => ({ ok: true, answer: answer(request) })), read: vi.fn<Bpic19Client["read"]>(async () => ({ ok: true, answer: answer() })) };
    render(<Bpic19Scoring subject={subject} client={client} onInspect={inspect} />);
    fireEvent.click(screen.getByRole("button", { name: "Run analysis" }));
    await screen.findByText(/2 of 2 items scored/);
    expect(client.score).toHaveBeenCalledWith(expect.objectContaining({ roles: subject.roles, settings: expect.objectContaining({ profile: "paper", mode: "flat", gamma: 0 }) }), expect.any(AbortSignal));
    fireEvent.click(screen.getByRole("button", { name: /^A$/ }));
    const witnessButtons = screen.getAllByRole("button", { name: "1 source records" });
    fireEvent.click(witnessButtons[0]);
    expect(inspect).toHaveBeenCalledWith("A", ["A:invoice_count"]);
    expect(screen.getAllByText("-0.025").length).toBeGreaterThan(0);
  });
  it("discards a pending answer after settings change and never presents it as the new view", async () => {
    let resolve: ((value: Bpic19Outcome) => void) | undefined;
    let sent: Bpic19ScoreRequest | undefined;
    const client: Bpic19Client = { score: vi.fn<Bpic19Client["score"]>(request => { sent = request; return new Promise<Bpic19Outcome>(r => { resolve = r; }); }), read: vi.fn() };
    render(<Bpic19Scoring subject={subject} client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Run analysis" }));
    fireEvent.change(screen.getByLabelText("Stakeholder view"), { target: { value: "Operations" } });
    if (!resolve || !sent) throw new Error("The request should be pending.");
    await act(async () => resolve?.({ ok: true, answer: answer(sent) }));
    expect(screen.queryByText(/items scored/)).toBeNull();
    expect(screen.getByRole("button", { name: "Run analysis" })).toBeTruthy();
  });
  it("restores historical settings and hides stale evidence when the source population changes", async () => {
    const saved = answer(); saved.report.profile_id = "bpic19.notebook.1.0-paper-aligned.v1";
    saved.report.settings.view = "Finance"; saved.report.settings.mode = "layer_balanced"; saved.report.settings.gamma = 20;
    const { rerender } = render(<Bpic19Scoring subject={subject} initialRun={saved} />);
    expect(screen.getByLabelText("Stakeholder view")).toHaveProperty("value", "Finance");
    expect(screen.getByLabelText("Gamma")).toHaveProperty("value", "20");
    expect(screen.getByText(/2 of 2 items scored/)).toBeTruthy();
    rerender(<Bpic19Scoring subject={{ ...subject, named_population: { ...subject.named_population,
      identity: { ...subject.named_population.identity, population_id: `population.v1:sha256:${"c".repeat(64)}` } } }} initialRun={saved} />);
    await waitFor(() => expect(screen.queryByText(/2 of 2 items scored/)).toBeNull());
  });
  it("invalidates a reviewed run when only source-role meaning changes", async () => {
    const valid = vi.fn(), reviewed = vi.fn();
    let resolve: ((value: Bpic19Outcome) => void) | undefined;
    let sent: Bpic19ScoreRequest | undefined;
    const client: Bpic19Client = {score: vi.fn<Bpic19Client["score"]>(request => {
      sent = request; return new Promise<Bpic19Outcome>(done => { resolve = done; });
    }),read:vi.fn()};
    const {rerender} = render(<Bpic19Scoring subject={subject} client={client} revision={12} onReviewed={reviewed} onValidityChange={valid} />);
    fireEvent.click(screen.getByRole("button",{name:"Run analysis"}));
    expect(valid).toHaveBeenLastCalledWith(false);
    expect(reviewed).not.toHaveBeenCalled();
    if (!resolve || !sent) throw new Error("The scoring request should be pending.");
    await act(async () => resolve?.({ok:true,answer:answer(sent)}));
    await screen.findByText(/2 of 2 items scored/);
    // DOM publication can precede the passive validity effect; await its own signal.
    await waitFor(() => { expect(reviewed).toHaveBeenCalledTimes(1); expect(valid).toHaveBeenLastCalledWith(true); });
    rerender(<Bpic19Scoring subject={{...subject,roles:{...subject.roles,resource:6}}} client={client} revision={12} onReviewed={reviewed} onValidityChange={valid} />);
    await waitFor(() => { expect(screen.queryByText(/2 of 2 items scored/)).toBeNull(); expect(valid).toHaveBeenLastCalledWith(false); });
    expect(reviewed).toHaveBeenCalledTimes(1);
  });
  it("inspects stored group members with the same run instead of scoring a subset", async () => {
    const client: Bpic19Client = {score: vi.fn(),read:vi.fn<Bpic19Client["read"]>(async request => ({ok:true,answer:{...answer(),request_id:request.request_id,query_revision:request.query_revision}}))};
    render(<Bpic19Scoring subject={subject} client={client} initialRun={answer()} />);
    fireEvent.click(screen.getByRole("button",{name:"Inspect members of A · Parts"}));
    await waitFor(() => expect(client.read).toHaveBeenCalledTimes(1));
    expect(client.score).not.toHaveBeenCalled();
    expect(client.read).toHaveBeenCalledWith(expect.objectContaining({run_id:base.run_id,case_filter:{group_values:{company:"A",spend_area:"Parts"}}}),expect.any(AbortSignal));
    expect(screen.getByText(/parent scores and reference are unchanged/)).toBeTruthy();
  });
});
