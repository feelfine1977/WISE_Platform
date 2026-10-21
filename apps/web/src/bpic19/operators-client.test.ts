import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bpic19OperatorRequest } from "../generated/bpic19-operators";
import { bpic19OperatorContract, httpBpic19OperatorsClient } from "./operators-client";
import { operatorAnswer, operatorIdentity, operatorRoles, operatorRecipe } from "./operators-test-fixture";
const request: Bpic19OperatorRequest = { schema_version: 1, message_type: "bpic19_operator_request", request_id: "operator-client", query_revision: 2, workspace_id: "workspace.v1:literal-fixture", identity: operatorIdentity,
  query: { policy_id: "bpic19.declared_operators.v1", roles: operatorRoles, recipe: operatorRecipe("ordinal"), offset: 0, limit: 20 } };
afterEach(() => vi.unstubAllGlobals());
describe("finite recorded-event HTTP boundary", () => {
  it("admits the five literal receipts and rejects duplicate witnesses and executable extensions", () => {
    for (const kind of ["ordinal", "fifo", "cancellation", "rule", "waiting"] as const) {
      const next = { ...request, query: { ...request.query, recipe: operatorRecipe(kind) } };
      expect(bpic19OperatorContract.request(next)).toBe(true);
      expect(bpic19OperatorContract.answer(operatorAnswer(next))).toBe(true);
    }
    const duplicate = operatorAnswer(request); duplicate.cases[0].record_row_ids.push(duplicate.cases[0].record_row_ids[0]);
    expect(bpic19OperatorContract.answer(duplicate)).toBe(false);
    expect(bpic19OperatorContract.request({ ...request, query_revision: true })).toBe(false);
    expect(bpic19OperatorContract.request({ ...request, query: { ...request.query, recipe: { ...request.query.recipe, execute: "callback" } } })).toBe(false);
  });
  it.each(["identity", "revision", "query", "definition", "operation", "support"])("refuses a mismatched %s", async field => {
    const answer = operatorAnswer(request);
    if (field === "identity") answer.identity = { ...answer.identity, population_id: `population.v1:sha256:${"f".repeat(64)}` };
    if (field === "revision") answer.query_revision = 1;
    if (field === "query") answer.query = { ...answer.query, recipe: operatorRecipe("fifo") };
    if (field === "definition") answer.definition.recipe = operatorRecipe("fifo");
    if (field === "operation") answer.operation = "bpic19_fifo";
    if (field === "support") answer.population_case_count++;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 })));
    expect(await httpBpic19OperatorsClient.operators(request, new AbortController().signal)).toMatchObject({ ok: false, problem: { kind: "unsupported_reply" } });
  });
  it("uses the real route, abort signal and uncached strict JSON; preserves typed refusals", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(operatorAnswer(request)), { status: 200 }));vi.stubGlobal("fetch", fetch);
    const abort = new AbortController();expect((await httpBpic19OperatorsClient.operators(request, abort.signal)).ok).toBe(true);
    expect(fetch.mock.calls[0][0]).toBe("/api/investigations/bpic19-operators");
    expect(fetch.mock.calls[0][1]).toMatchObject({ signal: abort.signal, cache: "no-store", method: "POST" });
    const refusal = { schema_version: 1, message_type: "bpic19_operator_refusal", request_id: request.request_id, query_revision: 2, workspace_id: request.workspace_id, operation: "bpic19_operators", code: "invalid_parameter", message: "Review original eventID.", field: "query.roles.event_id", retryable: false };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(refusal), { status: 400 })));
    expect(await httpBpic19OperatorsClient.operators(request, abort.signal)).toEqual({ ok: false, problem: { kind: "refusal", refusal } });
  });
  it("does not send unsupported requests or convert network/non-JSON failure to a zero", async () => {
    const fetch = vi.fn(async () => new Response("not json", { status: 200 }));vi.stubGlobal("fetch", fetch);
    expect(await httpBpic19OperatorsClient.operators({ ...request, query_revision: -1 }, new AbortController().signal)).toMatchObject({ ok: false });expect(fetch).not.toHaveBeenCalled();
    expect(await httpBpic19OperatorsClient.operators(request, new AbortController().signal)).toMatchObject({ ok: false, problem: { kind: "unsupported_reply" } });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await httpBpic19OperatorsClient.operators(request, new AbortController().signal)).toEqual({ ok: false, problem: { kind: "unreachable" } });
  });
});
