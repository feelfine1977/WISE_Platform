import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bpic19CohortsRequest, Bpic19CohortsAnswer } from "../generated/bpic19-cohorts";
import fixture from "./cohorts-test-answer.json";
import { answersCohorts, cohortsContract, httpCohortsClient } from "./cohorts-client";

if(!cohortsContract.answer(fixture)) throw new Error("Invalid cohort fixture");
const answer:Bpic19CohortsAnswer=fixture;
const request:Bpic19CohortsRequest={schema_version:1,message_type:"bpic19_cohorts_request",request_id:answer.request_id,query_revision:answer.query_revision,workspace_id:answer.workspace_id,identity:answer.identity,query:answer.query};
afterEach(()=>vi.unstubAllGlobals());
describe("cohort public contract",()=>{
  it("accepts its exact typed answer and rejects another parent or mismatched definition",()=>{
    expect(cohortsContract.request(request)).toBe(true);expect(answersCohorts(request,answer)).toBe(true);
    expect(answersCohorts(request,{...answer,identity:{...answer.identity,population_id:"population.v1:sha256:"+"f".repeat(64)}})).toBe(false);
    expect(answersCohorts(request,{...answer,definition:{...answer.definition,retain:"observed_closed"}})).toBe(false);
    expect(cohortsContract.request({...request,query:{...request.query,roles:{...request.query.roles,item_category:true}}})).toBe(false);
  });
  it("refuses a successful JSON response that belongs to an older query",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({...fixture,query_revision:2}),{status:200})));
    const outcome=await httpCohortsClient.cohorts(request,new AbortController().signal);
    expect(outcome.ok).toBe(false);if(!outcome.ok)expect(outcome.problem.kind).toBe("unsupported_reply");
  });
});
