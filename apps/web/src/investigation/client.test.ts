import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenExampleRequest } from "../generated/investigation";
import { populationZero, refusalOf } from "../test/answers";
import { caseEvidenceRoute, contract, httpInvestigationClient, openExampleRoute } from "./client";
import { examplePolicies } from "./policies";
import { describeProblem } from "./wording";

const request: OpenExampleRequest = {
  schema_version: 1,
  message_type: "open_example_request",
  request_id: "open-7",
  query_revision: 7,
  example_id: "S0",
  policies: examplePolicies,
};

function reply(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the investigation client", () => {
  it("posts the request to the open-example operation and returns a contract answer", async () => {
    const answer = populationZero(request);
    const fetch = reply(200, answer);
    const outcome = await httpInvestigationClient.openExample(request, new AbortController().signal);
    expect(outcome).toEqual({ ok: true, answer });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [route, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(route).toBe("/api/investigations/open-example");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(request);
    expect(openExampleRoute).toBe("/api/investigations/open-example");
    expect(caseEvidenceRoute).toBe("/api/investigations/case-evidence");
  });

  it("sends the registered policies, which the contract accepts", () => {
    expect(contract.openExampleRequest(request)).toBe(true);
  });

  it("returns a typed refusal whatever its status code", async () => {
    const refusal = refusalOf(request, "open_example", "source_unavailable", "The example is not available.");
    reply(404, refusal);
    const outcome = await httpInvestigationClient.openExample(request, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, problem: { kind: "refusal", refusal } });
  });

  it("reports a missing operation as not available rather than as an empty answer", async () => {
    reply(404, { detail: "API route not found" });
    const outcome = await httpInvestigationClient.openExample(request, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, problem: { kind: "http", status: 404 } });
    if (outcome.ok) return;
    expect(describeProblem(outcome.problem).message).toBe("Investigations are not available from this local service (HTTP 404).");
  });

  it("reports a reply outside the contract as unusable", async () => {
    const answer = { ...populationZero(request), coverage: { raw_record_count: "7", mapped_record_count: 6, omitted_activity_record_count: 1 } };
    reply(200, answer);
    const outcome = await httpInvestigationClient.openExample(request, new AbortController().signal);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.problem.kind).toBe("unsupported_reply");
  });

  it("reports a reply that is not JSON with its status", async () => {
    reply(500, "Internal Server Error");
    const outcome = await httpInvestigationClient.openExample(request, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, problem: { kind: "http", status: 500 } });
  });

  it("reports an unreachable service", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const outcome = await httpInvestigationClient.openExample(request, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, problem: { kind: "unreachable" } });
  });
});
