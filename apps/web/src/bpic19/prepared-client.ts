import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/bpic19-prepared-runs.schema.json";
import {sameJson} from "../data/coordinator";
import {uniqueItemsHold,withoutUniqueItems} from "../data/uniqueItems";
import type {Bpic19PreparedReviewRequest,Bpic19PreparedReviewAnswer,Bpic19PreparedRunRequest,Bpic19PreparedRunAnswer,
  Bpic19PreparedReadRequest,Bpic19PreparedReadAnswer,Bpic19PreparedExportRequest,Bpic19PreparedRefusal,PreparedInput,PreparedReference} from "../generated/bpic19-prepared-runs";

export type PreparedProblem={kind:"refusal";refusal:Bpic19PreparedRefusal}|{kind:"unreachable"}|{kind:"unsupported_reply";detail:string};
export type PreparedOutcome<T>={ok:true;answer:T}|{ok:false;problem:PreparedProblem};
export interface PreparedDownload {blob:Blob;filename:string}
export interface PreparedClient {
  review(request:Bpic19PreparedReviewRequest,signal:AbortSignal):Promise<PreparedOutcome<Bpic19PreparedReviewAnswer>>;
  run(request:Bpic19PreparedRunRequest,signal:AbortSignal):Promise<PreparedOutcome<Bpic19PreparedRunAnswer>>;
  read(request:Bpic19PreparedReadRequest,signal:AbortSignal):Promise<PreparedOutcome<Bpic19PreparedReadAnswer>>;
  export(request:Bpic19PreparedExportRequest,signal:AbortSignal):Promise<PreparedOutcome<PreparedDownload>>;
}
const ajv=new Ajv2020({allErrors:true,allowUnionTypes:true,strictTypes:false});
// Frozen catalogue annotations; admission remains governed by the JSON Schema assertions.
ajv.addKeyword({keyword:"x-applicable-flows",schemaType:"array",valid:true});
ajv.addKeyword({keyword:"x-source-operator",schemaType:"string",valid:true});
ajv.addSchema(withoutUniqueItems(schema));
function check<T>(name:string){
  const validate=ajv.getSchema<T>(schema.$id+"#/$defs/"+name);
  if(!validate)throw new Error("Missing prepared boundary "+name);
  return (value:unknown):value is T=>validate(value)&&uniqueItemsHold(schema,{$ref:"#/$defs/"+name},value);
}
export const preparedContract={reviewRequest:check<Bpic19PreparedReviewRequest>("Bpic19PreparedReviewRequest"),
  reviewAnswer:check<Bpic19PreparedReviewAnswer>("Bpic19PreparedReviewAnswer"),runRequest:check<Bpic19PreparedRunRequest>("Bpic19PreparedRunRequest"),
  runAnswer:check<Bpic19PreparedRunAnswer>("Bpic19PreparedRunAnswer"),readAnswer:check<Bpic19PreparedReadAnswer>("Bpic19PreparedReadAnswer"),
  refusal:check<Bpic19PreparedRefusal>("Bpic19PreparedRefusal"),input:check<PreparedInput>("PreparedInput"),reference:check<PreparedReference>("PreparedReference")};
type Echo={request_id:string;query_revision:number;workspace_id:string};
const echo=(request:Echo,answer:Echo)=>request.request_id===answer.request_id&&request.query_revision===answer.query_revision&&request.workspace_id===answer.workspace_id;
const unsupported=<T,>(detail="The prepared reply does not match this request, workspace or stored reference."):PreparedOutcome<T>=>({ok:false,problem:{kind:"unsupported_reply",detail}});
function refusal(request:Echo,payload:unknown):PreparedOutcome<never>|null{
  if(!preparedContract.refusal(payload))return null;
  if((payload.request_id!==null&&payload.request_id!==request.request_id)||(payload.query_revision!==null&&payload.query_revision!==request.query_revision)||
    (payload.workspace_id!==null&&payload.workspace_id!==request.workspace_id))return unsupported();
  return {ok:false,problem:{kind:"refusal",refusal:payload}};
}
async function post(operation:string,request:Echo,signal:AbortSignal):Promise<Response|null>{
  try{return await fetch("/api/investigations/bpic19-prepared/"+operation,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(request),signal,cache:"no-store"});}
  catch{return null;}
}
async function json<T>(operation:string,request:Echo,signal:AbortSignal,valid:(value:unknown)=>value is T,belongs:(answer:T)=>boolean):Promise<PreparedOutcome<T>>{
  const response=await post(operation,request,signal);if(!response)return {ok:false,problem:{kind:"unreachable"}};
  let payload:unknown;try{payload=await response.json();}catch{return unsupported();}
  const denied=refusal(request,payload);if(denied)return denied;
  return response.ok&&valid(payload)&&belongs(payload)?{ok:true,answer:payload}:unsupported();
}
function pageMatches(answer:Bpic19PreparedRunAnswer|Bpic19PreparedReadAnswer){
  return answer.basis.input_id===answer.reference.input_id&&answer.definition.definition_id===answer.reference.definition_id&&
    answer.definition.view===answer.reference.view&&answer.offset+answer.cases.length<=answer.total&&
    answer.complete===(answer.next_offset===null)&&
    (answer.next_offset===null?answer.offset+answer.cases.length===answer.total:answer.cases.length>0&&answer.next_offset===answer.offset+answer.cases.length);
}
export const httpPreparedClient:PreparedClient={
  review(request,signal){return json("review",request,signal,preparedContract.reviewAnswer,answer=>echo(request,answer)&&
    answer.input.content_id===answer.basis.input_id&&sameJson(answer.input.rows,request.rows)&&
    sameJson(answer.basis.assessment_item_ids,request.rows.map(row=>row.assessment_item_id)));},
  run(request,signal){return json("run",request,signal,preparedContract.runAnswer,answer=>echo(request,answer)&&pageMatches(answer)&&answer.offset===0&&
    answer.reference.input_id===request.input_id&&answer.reference.view===request.view);},
  read(request,signal){return json("read",request,signal,preparedContract.readAnswer,answer=>echo(request,answer)&&pageMatches(answer)&&
    answer.reference.run_id===request.run_id&&answer.offset===request.offset&&answer.cases.length<=request.limit);},
  async export(request,signal){
    const response=await post("export",request,signal);if(!response)return {ok:false,problem:{kind:"unreachable"}};
    const type=response.headers.get("Content-Type")?.split(";")[0].trim();
    const expected={json:"application/json",markdown:"text/markdown",native_zip:"application/zip"}[request.format];
    const blob=await response.blob();
    if(type==="application/json"){
      let payload:unknown;try{payload=JSON.parse(await blob.text());}catch{return unsupported();}
      const denied=refusal(request,payload);if(denied)return denied;
    }
    const filename=response.headers.get("Content-Disposition")?.match(/filename="(prepared-(?:finance|logistics|compliance|automation)\.(?:json|md|zip))"/)?.[1];
    if(!response.ok||type!==expected||!filename)return unsupported("The prepared download has no supported content type or immutable filename.");
    return {ok:true,answer:{blob,filename}};
  },
};
export function preparedProblemText(problem:PreparedProblem):string{
  return problem.kind==="refusal"?problem.refusal.message+(problem.refusal.field?" ("+problem.refusal.field+")":""):
    problem.kind==="unsupported_reply"?problem.detail:"The local prepared-assessment service could not be reached. Retry the operation.";
}
/** Rehydrate only stored declaration bytes, never infer source rows or call Run. */
export async function inputFromPreparedExport(download:PreparedDownload,reference:PreparedReference):Promise<PreparedInput|null>{
  let value:unknown;try{value=JSON.parse(await download.blob.text());}catch{return null;}
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const body=value as Record<string,unknown>;
  return body.format==="bpic19.declared-prepared-export.v1"&&preparedContract.reference(body.reference)&&sameJson(body.reference,reference)&&
    preparedContract.input(body.input)&&body.input.content_id===reference.input_id?body.input:null;
}
