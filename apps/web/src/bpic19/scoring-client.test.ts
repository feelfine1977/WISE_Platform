import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./scoring-fixtures/native-two-items.json";
import { bpic19Contract, localBpic19Client } from "./scoring-client";
import type { Bpic19ScoreAnswer, Bpic19ScoreRequest } from "./scoring-types";

export function literalAnswer(): Bpic19ScoreAnswer {
  const value: unknown = structuredClone(fixture);
  if (!bpic19Contract.answer(value)) throw new Error("The packed Method fixture must satisfy the contract.");
  return value;
}
function request(): Bpic19ScoreRequest {
  const answer = literalAnswer();
  return { schema_version: 1, message_type: "bpic19_score_request", request_id: answer.request_id,
    query_revision: answer.query_revision, workspace_id: answer.workspace_id, base_identity: answer.base_identity,
    named_population: answer.named_population, roles: { item_category: 3, resource: 5, net_worth: 7 },
    settings: { profile: "paper", criteria_family: "full", view: "Balanced", mode: "flat", gamma: 0, group_by: ["company", "spend_area"], min_cases: 1,
      volume: "cases", exposure_policy: "max_absolute_p95" }, case_offset: 0, case_limit: 50 };
}
afterEach(() => vi.unstubAllGlobals());
describe("BPIC19 native scoring boundary", () => {
  it("accepts the actual native report and rejects unknown roles or false release receipts", () => {
    expect(bpic19Contract.request(request())).toBe(true);
    expect(bpic19Contract.request({ ...request(), roles: { unexplained_field: 3 } })).toBe(false);
    const changed = literalAnswer();
    changed.report.method_artifact = { ...changed.report.method_artifact, eligible_release: false };
    expect(bpic19Contract.answer(changed)).toBe(true);
    expect(bpic19Contract.answer({ ...changed, report: { ...changed.report, method_artifact: { ...changed.report.method_artifact, eligible_release: true } } })).toBe(false);
  });
  it("rejects a reply for another ranking configuration even if envelope identities match", async () => {
    const answer = literalAnswer(); answer.report.settings.gamma = 20;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(answer), { status: 200 })));
    const outcome = await localBpic19Client.score(request(), new AbortController().signal);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("different analysis settings");
  });
  it("rejects an unsupported numeric or incomplete response instead of showing an empty success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...literalAnswer(), report: {} }), { status: 200 })));
    const outcome = await localBpic19Client.score(request(), new AbortController().signal);
    expect(outcome.ok).toBe(false);
  });
});
