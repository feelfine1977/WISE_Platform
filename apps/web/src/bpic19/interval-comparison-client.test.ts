import { afterEach, describe, expect, it, vi } from "vitest";
import { bpic19IntervalComparisonContract, httpIntervalComparisonClient } from "./interval-comparison-client";
import { intervalAnswer, intervalRequest } from "./interval-comparison-test-fixture";
afterEach(() => vi.restoreAllMocks());
describe("registered interval comparison boundary", () => {
  it("validates authority and rejects duplicate membership or endpoint witnesses", () => {
    const request=intervalRequest(),answer=intervalAnswer(request);
    expect(bpic19IntervalComparisonContract.request(request)).toBe(true);expect(bpic19IntervalComparisonContract.answer(answer)).toBe(true);
    const duplicate=structuredClone(request);duplicate.query.target.recipe.case_ids.push("T0");expect(bpic19IntervalComparisonContract.request(duplicate)).toBe(false);
    const witnesses=structuredClone(answer);witnesses.comparison.page.items[0].source.row_ids.push(witnesses.comparison.page.items[0].source.row_ids[0]);
    expect(bpic19IntervalComparisonContract.answer(witnesses)).toBe(false);
  });
  it("posts finite declarations and fences foreign parents or selectors", async () => {
    const request=intervalRequest(),answer=intervalAnswer(request),fetch=vi.spyOn(globalThis,"fetch"),signal=new AbortController().signal;
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(answer),{status:200}));expect((await httpIntervalComparisonClient.compare(request,signal)).ok).toBe(true);
    expect(fetch.mock.calls[0][0]).toBe("/api/investigations/bpic19-interval-comparison");expect(fetch.mock.calls[0][1]?.signal).toBe(signal);
    const foreign=structuredClone(answer);foreign.identity.population_id="population.v1:sha256:"+"f".repeat(64);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(foreign),{status:200}));expect(await httpIntervalComparisonClient.compare(request,signal)).toMatchObject({ok:false,problem:{kind:"unsupported_reply"}});
    const changed=structuredClone(answer);changed.query.interval_source=["Change Price"];
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(changed),{status:200}));expect(await httpIntervalComparisonClient.compare(request,signal)).toMatchObject({ok:false,problem:{kind:"unsupported_reply"}});
  });
  it("preserves a typed refusal instead of publishing zero distributions",async()=>{
    const request=intervalRequest();const refusal={schema_version:1,message_type:"bpic19_interval_comparison_refusal",operation:"bpic19_interval_comparison",request_id:request.request_id,query_revision:request.query_revision,workspace_id:request.workspace_id,code:"invalid_parent",message:"Side outside reviewed parent",field:"query.target.recipe.case_ids",retryable:false};
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify(refusal),{status:422}));
    expect(await httpIntervalComparisonClient.compare(request,new AbortController().signal)).toMatchObject({ok:false,problem:{kind:"refusal",refusal}});
  });
});
