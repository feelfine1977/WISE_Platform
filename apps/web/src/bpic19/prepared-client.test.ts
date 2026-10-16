import {afterEach,expect,it,vi} from "vitest";
import fixture from "../test/prepared-api.json";
import {httpPreparedClient,preparedContract} from "./prepared-client";
import type {Bpic19PreparedReviewRequest} from "../generated/bpic19-prepared-runs";

afterEach(()=>vi.unstubAllGlobals());
const request=()=>({schema_version:1,message_type:"bpic19_prepared_review_request",request_id:"prepared-review-1",query_revision:1,
  workspace_id:fixture.review.workspace_id,rows:fixture.review.input.rows}) as Bpic19PreparedReviewRequest;

it("accepts the exact server review but refuses another workspace or request stamp",async()=>{
  const asked=request(),answer={...fixture.review,request_id:asked.request_id,query_revision:asked.query_revision};
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(answer),{headers:{"Content-Type":"application/json"}}))
    .mockResolvedValueOnce(new Response(JSON.stringify({...answer,workspace_id:"workspace.v1:sha256:"+"a".repeat(64)}),{headers:{"Content-Type":"application/json"}}));
  vi.stubGlobal("fetch",fetcher);
  expect(preparedContract.reviewRequest(asked)).toBe(true);
  expect(await httpPreparedClient.review(asked,new AbortController().signal)).toEqual({ok:true,answer});
  expect(await httpPreparedClient.review(asked,new AbortController().signal)).toMatchObject({ok:false,problem:{kind:"unsupported_reply"}});
  expect(fetcher.mock.calls[0][0]).toBe("/api/investigations/bpic19-prepared/review");
});

it("refuses a nonterminal native page that makes no forward progress",async()=>{
  const asked={schema_version:1 as const,message_type:"bpic19_prepared_run_request" as const,request_id:"run-1",query_revision:1,workspace_id:fixture.run.workspace_id,
    input_id:fixture.run.reference.input_id,profile_id:"bpic19.notebook.1.0-paper-aligned.v1" as const,
    catalogue_sha256:"498d0464d11ede078bf75818d0b329ff946077ffbe93a4b6f5f4aaf27eeddaef" as const,mode:"layer_balanced" as const,view:"Finance" as const};
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({...fixture.run,request_id:"run-1",query_revision:1,cases:[],offset:0,complete:false,next_offset:0}),{headers:{"Content-Type":"application/json"}})));
  expect(await httpPreparedClient.run(asked,new AbortController().signal)).toMatchObject({ok:false,problem:{kind:"unsupported_reply"}});
});
