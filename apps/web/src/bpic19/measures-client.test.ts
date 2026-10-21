import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bpic19MeasuresRequest } from "../generated/bpic19-measures";
import { bpic19MeasuresContract, httpBpic19MeasuresClient } from "./measures-client";
import { measuresAnswer, measuresIdentity, measuresRoles } from "./measures-test-fixture";

const request: Bpic19MeasuresRequest = { schema_version: 1, message_type: "bpic19_measures_request", request_id: "literal-measures", query_revision: 2,
  workspace_id: "workspace.v1:literal-fixture", identity: measuresIdentity,
  query: { policy_id: "bpic19.source_witnessed_measures.v1", measure_profile: "paper_v1", roles: measuresRoles, offset: 0, limit: 20, calibration_population: "parent" } };
afterEach(() => vi.unstubAllGlobals());

describe("the BPIC19 measures boundary", () => {
  it("accepts a literal oracle and refuses duplicate witnesses, booleans and unknown profiles", () => {
    expect(bpic19MeasuresContract.request(request)).toBe(true);
    expect(bpic19MeasuresContract.answer(measuresAnswer(request))).toBe(true);
    const duplicate = measuresAnswer(request); duplicate.cases[0].record_row_ids.push("row-1");
    expect(bpic19MeasuresContract.answer(duplicate)).toBe(false);
    expect(bpic19MeasuresContract.request({ ...request, query_revision: true })).toBe(false);
    expect(bpic19MeasuresContract.request({ ...request, query: { ...request.query, measure_profile: "all" } })).toBe(false);
  });

  it("refuses an otherwise valid reply for another frozen population", async () => {
    const answer = measuresAnswer(request); answer.identity = { ...measuresIdentity, population_id: `population.v1:sha256:${"1".repeat(64)}` };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 })));
    const outcome = await httpBpic19MeasuresClient.measures(request, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not answer these measures, source identity and population." } });
  });

  it.each(["request", "revision", "definition"])("refuses a reply for an older %s", async field => {
    const answer = measuresAnswer(request);
    if (field === "request") answer.request_id = "earlier-request";
    if (field === "revision") answer.query_revision = 1;
    if (field === "definition") answer.query = { ...request.query, measure_profile: "historical_v1" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 })));
    expect(await httpBpic19MeasuresClient.measures(request, new AbortController().signal)).toMatchObject({ ok: false, problem: { kind: "unsupported_reply" } });
  });

  it("passes cancellation to HTTP and keeps typed refusals bound to the requested revision", async () => {
    const refusal = { schema_version: 1, message_type: "bpic19_measures_refusal", request_id: request.request_id, query_revision: 1,
      workspace_id: request.workspace_id, operation: "bpic19_measures", code: "unsupported_definition", message: "That policy is not admitted.", field: "interval_policy", retryable: false };
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(refusal), { status: 422 }));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    expect(await httpBpic19MeasuresClient.measures(request, controller.signal)).toMatchObject({ ok: false, problem: { kind: "unsupported_reply" } });
    expect(fetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal, cache: "no-store" });
    refusal.query_revision = 2;
    expect(await httpBpic19MeasuresClient.measures(request, controller.signal)).toEqual({ ok: false, problem: { kind: "refusal", refusal } });
  });

  it("does not submit an unsupported request or interpret a non-JSON reply as zero", async () => {
    const fetch = vi.fn(async () => new Response("not a measure answer", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await httpBpic19MeasuresClient.measures({ ...request, query_revision: -1 }, new AbortController().signal)).toMatchObject({ ok: false, problem: { kind: "unsupported_reply" } });
    expect(fetch).not.toHaveBeenCalled();
    expect(await httpBpic19MeasuresClient.measures(request, new AbortController().signal)).toMatchObject({ ok: false, problem: { kind: "unsupported_reply" } });
  });
});
