import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bpic19ProfileAnswer, Bpic19ProfileRequest } from "../generated/bpic19-profile";
import fixture from "./profile-test-answer.json";
import { answersBpic19Profile, bpic19ProfileContract, httpBpic19ProfileClient } from "./profile-client";

if (!bpic19ProfileContract.answer(fixture)) throw new Error("Invalid literal profile fixture");
const answer: Bpic19ProfileAnswer = fixture;
const request: Bpic19ProfileRequest = { schema_version: 1, message_type: "bpic19_profile_request", request_id: answer.request_id, query_revision: answer.query_revision, workspace_id: answer.workspace_id, identity: answer.identity, query: answer.query };
afterEach(() => vi.unstubAllGlobals());

describe("the purchasing profile public boundary", () => {
  it("checks answer identity, reviewed query and revision", () => {
    expect(answersBpic19Profile(request, answer)).toBe(true);
    expect(answersBpic19Profile(request, { ...answer, query_revision: 999 })).toBe(false);
    expect(answersBpic19Profile(request, { ...answer, identity: { ...answer.identity, population_id: "population.v1:sha256:"+"f".repeat(64) } })).toBe(false);
    expect(answersBpic19Profile(request, { ...answer, query: { ...answer.query, roles: null } })).toBe(false);
  });
  it("rejects repeated membership and unsupported JSON types", () => {
    const bad = structuredClone(fixture);
    if (!bad.profile) throw new Error("Missing fixture profile");
    bad.profile.flows[0].case_ids.push(bad.profile.flows[0].case_ids[0]);
    expect(bpic19ProfileContract.answer(bad)).toBe(false);
    expect(bpic19ProfileContract.request({ ...request, query_revision: true })).toBe(false);
  });
  it("does not accept an otherwise valid stale HTTP answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...answer, query_revision: 999 }), { status: 200 })));
    const outcome = await httpBpic19ProfileClient.profile(request, new AbortController().signal);
    expect(outcome).toMatchObject({ ok: false, problem: { kind: "unsupported_reply" } });
  });
});
