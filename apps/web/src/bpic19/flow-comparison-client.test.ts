import { afterEach, expect, it, vi } from "vitest";
import fixture from "./flow-comparison-test-answer.json";
import type { Bpic19FlowComparisonAnswer, Bpic19FlowComparisonRequest } from "../generated/bpic19-flow-comparison";
import { answersFlowComparison, bpic19FlowComparisonContract, httpFlowComparisonClient } from "./flow-comparison-client";
import { flowComparisonQuery } from "./Bpic19FlowComparison";
import type { Bpic19ComparisonSide } from "./profile-types";
import profileFixture from "./profile-test-answer.json";
import { bpic19ProfileContract } from "./profile-client";

afterEach(()=>vi.unstubAllGlobals());
function literal():Bpic19FlowComparisonAnswer {const value:unknown=fixture;if(!bpic19FlowComparisonContract.answer(value))throw new Error("Invalid literal answer");return value;}
function request():Bpic19FlowComparisonRequest {const a=literal();return {schema_version:1,message_type:"bpic19_flow_comparison_request",request_id:a.request_id,query_revision:a.query_revision,workspace_id:a.workspace_id,identity:a.identity,query:a.query};}

it("validates supplied shares/roles/recipes and rejects a reply for another query/population/definition",()=>{
  const q=request(),a=literal();expect(answersFlowComparison(q,a)).toBe(true);
  expect(answersFlowComparison(q,{...a,query_revision:2})).toBe(false);
  expect(answersFlowComparison(q,{...a,identity:{...a.identity,population_id:"population.v1:sha256:"+"f".repeat(64)}})).toBe(false);
  expect(answersFlowComparison(q,{...a,definition_id:"bpic19-flow-comparison.v1:sha256:"+"f".repeat(64)})).toBe(false);
  expect(bpic19FlowComparisonContract.answer({...a,comparison:{...a.comparison,unavailable:{...a.comparison.unavailable,case_ids:["Z_1","Z_1"]}}})).toBe(false);
});

it("uses the registered HTTP route and retains a typed refusal without fabricated empty support",async()=>{
  const q=request();vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(literal()),{status:200,headers:{"Content-Type":"application/json"}})));
  const result=await httpFlowComparisonClient.compare(q,new AbortController().signal);expect(result.ok).toBe(true);
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/investigations/bpic19-flow-comparison");
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({schema_version:1,message_type:"bpic19_flow_comparison_refusal",request_id:q.request_id,query_revision:q.query_revision,workspace_id:q.workspace_id,operation:"bpic19_flow_comparison",code:"identity_mismatch",message:"Review the current parent",field:"query.profile_definition_id",retryable:false}),{status:409})));
  const refused=await httpFlowComparisonClient.compare(q,new AbortController().signal);expect(refused.ok).toBe(false);if(!refused.ok)expect(refused.problem.kind).toBe("refusal");
});

it("retains exact reviewed profile and both subtype predicates instead of making the reference a complement",()=>{
  const candidate:unknown=profileFixture;if(!bpic19ProfileContract.answer(candidate) || !candidate.profile)throw new Error("Invalid literal profile");
  const recipe={definition_id:candidate.profile.definition_id,definition:candidate.profile.definition,source_identity:candidate.identity,query:candidate.query,group:{kind:"flow_item_type" as const,flow_id:"after_gr",state:"invariant",item_type_value:"Standard"},case_ids:["D4_1"]};
  const target:Bpic19ComparisonSide={name:"Standard",caseIds:["D4_1"],recipe};
  const reference:Bpic19ComparisonSide={name:"Service",caseIds:["D1_1"],recipe:{...recipe,group:{...recipe.group,item_type_value:"Service"},case_ids:["D1_1"]}};
  const q=flowComparisonQuery(target,reference);expect(q.profile_query).toEqual(candidate.query);expect(q.target.item_type_value).toBe("Standard");expect(q.reference.item_type_value).toBe("Service");
  expect(()=>flowComparisonQuery(target,{...reference,recipe:{...reference.recipe,definition_id:"different"}})).toThrow(/same reviewed parent/);
});
