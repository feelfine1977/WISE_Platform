import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Bpic19Associations } from "./Bpic19Associations";
import { associationKeepAction } from "./association-keep";
import { bpic19Contract, localBpic19Client, type Bpic19Client, type Bpic19Outcome } from "./scoring-client";
import type { Bpic19AssociationRequest, Bpic19ScoreAnswer } from "./scoring-types";
import fixture from "./scoring-fixtures/native-association-seven-items.json";

// The service's own answer for the T21 literal: target t1..t5 with A=[.5,0,NA,1,0], B=[1,NA,.5,0,0], comparator c1, c2.
function answer(): Bpic19ScoreAnswer { const raw: unknown = structuredClone(fixture); if (!bpic19Contract.answer(raw)) throw Error("Native HTTP fixture invalid"); return raw; }
type Pair = Record<string, unknown>;
function pairOf(value: Bpic19ScoreAnswer): Pair { return ((value.report.association_analysis as Record<string, unknown>).accepted_pairs as Pair[])[0]; }
function client(): Bpic19Client {
  return { score: vi.fn(), read: vi.fn(), associate: vi.fn(async request => ({ ok: true as const, answer: { ...answer(), request_id: request.request_id, query_revision: request.query_revision } })) };
}
afterEach(() => vi.unstubAllGlobals());

describe("#123 association sets, ratios and late answers", () => {
  it("keeps the unavailable A member as a typed step tied to this native association run", async () => {
    const c = client(), kept = vi.fn();
    render(<Bpic19Associations answer={answer()} client={c} onReviewed={vi.fn()} onMembers={vi.fn()} onKeepSet={kept} />);
    fireEvent.click(screen.getByRole("button", { name: "Keep target unavailable A" }));
    await waitFor(() => expect(kept).toHaveBeenCalledTimes(1));
    const [shown, set, members] = kept.mock.calls[0];
    expect([set, members]).toEqual([{ population: "target", criterion_id: "A", state: "unavailable" }, ["t3"]]);
    expect(c.read).not.toHaveBeenCalled();
    const action = associationKeepAction(shown, set, members, { kind: "case_id_in", case_ids: ["t3"], negate: false }, 0, 0);
    expect(action).toEqual(expect.objectContaining({ operation: "bpic19_score", definition_id: shown.definition_id,
      query: { run_id: shown.run_id, case_offset: 0, case_limit: 50, group_offset: 0, group_limit: 50 }, selection_prefix_length: 0,
      selection_keep: { policy_id: "bpic19.association_set_keep.v1", step_index: 0, group: { kind: "association_set", population: "target", criterion_id: "A", state: "unavailable" } } }));
    // Another membership than the named set is not bound to it.
    expect(associationKeepAction(shown, set, members, { kind: "case_id_in", case_ids: ["t2"], negate: false }, 0, 0)).toBeNull();
  });

  it("reads every page of a set larger than the bounded list before keeping it", async () => {
    const shown = answer(), pair = pairOf(shown);
    pair.intersection_case_ids_receipt = { ...(pair.intersection_case_ids_receipt as object), count: 1, complete: false, next_offset: 200 };
    const c = client(), kept = vi.fn();
    c.read = vi.fn(async request => ({ ok: true as const, answer: { ...shown, request_id: request.request_id,
      report: { ...shown.report, case_page: { offset: 0, limit: 200, total: 1, cases: [{ ...shown.report.case_page.cases[0], case_id: "t1" }] } } } }));
    render(<Bpic19Associations answer={shown} client={c} onReviewed={vi.fn()} onMembers={vi.fn()} onKeepSet={kept} />);
    fireEvent.click(screen.getByRole("button", { name: "Keep intersection A/B" }));
    await waitFor(() => expect(kept).toHaveBeenCalledWith(shown, { population: "target", state: "all", pair: { left: "A", right: "B", set: "intersection" } }, ["t1"]));
    expect(c.read).toHaveBeenCalledWith(expect.objectContaining({ run_id: shown.run_id, case_offset: 0, case_limit: 200,
      case_filter: { association_set: { population: "target", state: "all", pair: { left: "A", right: "B", set: "intersection" } } } }), expect.any(AbortSignal));
  });

  it("names unavailable ratios by reason and shows a derived dependency's lineage", () => {
    const shown = answer(), pair = pairOf(shown);
    Object.assign(pair, { jaccard: null, jaccard_reason: "zero_support", lift: null, lift_reason: "zero_support",
      dependency: { ...(pair.dependency as object), flag: "deterministic_derived", right_attribute: "A" } });
    render(<Bpic19Associations answer={shown} client={client()} onReviewed={vi.fn()} onMembers={vi.fn()} />);
    expect(screen.getAllByText("Unavailable · zero_support")).toHaveLength(2);
    expect(screen.getByText("deterministic_derived · A / A")).toBeTruthy();
    expect(screen.getByText("accepted")).toBeTruthy();
  });

  it("shows a refused association setting with its code and field", async () => {
    const given: Bpic19AssociationRequest = { schema_version: 1, message_type: "bpic19_association_request", request_id: "refused", query_revision: 4,
      workspace_id: answer().workspace_id, run_id: answer().run_id, case_offset: 0, case_limit: 50, group_offset: 0, group_limit: 50,
      query: { policy_id: "bpic19.frozen_native_associations.v1", target: { name: "T", selector: { kind: "all" } }, comparator: { name: "C", selector: { kind: "outside_target" } },
        criteria: ["A"], positive_threshold: 0, min_support: 1, pair_mode: "jointly_eligible", pooled_sd: false } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ schema_version: 1, message_type: "bpic19_refusal", request_id: "refused",
      query_revision: 4, workspace_id: given.workspace_id, code: "invalid_parameter", message: "Choose distinct criteria in the saved native norm.",
      field: "query.criteria", retryable: false }), { status: 400 })));
    const outcome = await localBpic19Client.associate!(given, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, message: "Choose distinct criteria in the saved native norm. (invalid_parameter · query.criteria)" });
  });

  it("publishes neither a cancelled comparison, an overtaken one, nor one that arrives after the view closes", async () => {
    const pending: ((outcome: Bpic19Outcome) => void)[] = [], sent: Bpic19AssociationRequest[] = [];
    const c = client(); c.associate = vi.fn(request => { sent.push(request); return new Promise<Bpic19Outcome>(resolve => { pending.push(resolve); }); });
    const reviewed = vi.fn(), valid = vi.fn();
    const view = render(<Bpic19Associations answer={answer()} client={c} onReviewed={reviewed} onValidityChange={valid} onMembers={vi.fn()} />);
    const compare = () => fireEvent.click(screen.getByRole("button", { name: "Compare frozen criteria" }));
    // Cancelled: the late success is discarded and the definition stays unreviewed.
    compare(); fireEvent.click(screen.getByRole("button", { name: "Cancel comparison" }));
    await act(async () => pending[0]({ ok: true, answer: { ...answer(), request_id: sent[0].request_id } }));
    expect(reviewed).not.toHaveBeenCalled(); expect(valid).toHaveBeenLastCalledWith(false);
    // Overtaken: a support change and a new comparison; the older answer arriving later is ignored, the current one is published.
    compare();
    fireEvent.change(screen.getByLabelText("Reviewed minimum support"), { target: { value: "2" } });
    compare();
    expect(sent.map(request => request.query.min_support)).toEqual([1, 1, 2]);
    await act(async () => pending[1]({ ok: true, answer: { ...answer(), request_id: sent[1].request_id } }));
    expect(reviewed).not.toHaveBeenCalled();
    await act(async () => pending[2]({ ok: true, answer: { ...answer(), request_id: sent[2].request_id } }));
    expect(reviewed).toHaveBeenCalledTimes(1);
    expect(reviewed.mock.calls[0][0].request_id).toBe(sent[2].request_id);
    // Closed: nothing is published after unmount.
    fireEvent.change(screen.getByLabelText("Reviewed minimum support"), { target: { value: "3" } });
    compare(); view.unmount();
    await act(async () => pending[3]({ ok: true, answer: answer() }));
    expect(reviewed).toHaveBeenCalledTimes(1);
  });
});
