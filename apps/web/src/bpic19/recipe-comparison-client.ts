import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/bpic19-recipe-comparison.schema.json";
import { sameJson } from "../data/coordinator";
import { uniqueItemsHold, withoutUniqueItems } from "../data/uniqueItems";
import { bpic19OperatorContract } from "./operators-client";
import { cohortsContract } from "./cohorts-client";
import type { Bpic19RecipeComparisonAnswer, Bpic19RecipeComparisonRefusal, Bpic19RecipeComparisonRequest } from "../generated/bpic19-recipe-comparison";

export type Bpic19RecipeComparisonProblem =
  | { kind: "refusal"; refusal: Bpic19RecipeComparisonRefusal }
  | { kind: "unreachable" }
  | { kind: "unsupported_reply"; detail: string };
export type Bpic19RecipeComparisonOutcome = { ok: true; answer: Bpic19RecipeComparisonAnswer } | { ok: false; problem: Bpic19RecipeComparisonProblem };
export interface Bpic19RecipeComparisonClient {
  compare(request: Bpic19RecipeComparisonRequest, signal: AbortSignal): Promise<Bpic19RecipeComparisonOutcome>;
}
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(withoutUniqueItems(schema));
function check<T>(name: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`Missing BPIC19 boundary ${name}`);
  return (value: unknown): value is T => validate(value) && uniqueItemsHold(schema, { $ref: `#/$defs/${name}` }, value);
}
export const bpic19RecipeComparisonContract = {
  request: check<Bpic19RecipeComparisonRequest>("Bpic19RecipeComparisonRequest"), answer: check<Bpic19RecipeComparisonAnswer>("Bpic19RecipeComparisonAnswer"), refusal: check<Bpic19RecipeComparisonRefusal>("Bpic19RecipeComparisonRefusal"),
};
export function answersRecipeComparison(request: Bpic19RecipeComparisonRequest, answer: Bpic19RecipeComparisonAnswer): boolean {
  if (!(request.request_id === answer.request_id && request.query_revision === answer.query_revision && request.workspace_id === answer.workspace_id &&
    sameJson(request.identity, answer.identity) && sameJson(request.query, answer.query) && answer.definition_id === answer.comparison.definition_id &&
    sameJson(answer.definition, {identity:request.identity,query:request.query}))) return false;
  const query=request.query, {first,second}=answer.comparison;
  if (query.policy_id==='bpic19.ordinal_fifo_comparison.v1') {
    return answer.operation==='bpic19_operator_comparison' && bpic19OperatorContract.answer(first) && bpic19OperatorContract.answer(second) &&
      first.operation==='bpic19_ordinal' && second.operation==='bpic19_fifo' && first.definition_id===query.ordinal.definition_id && second.definition_id===query.fifo.definition_id &&
      sameJson(first.query,query.ordinal.query) && sameJson(second.query,query.fifo.query) && sameJson(first.identity,request.identity) && sameJson(second.identity,request.identity) && sameJson(first.parent_identity,second.parent_identity);
  }
  return answer.operation==='bpic19_cohort_comparison' && cohortsContract.answer(first) && cohortsContract.answer(second) &&
    first.definition_id===query.target.definition_id && second.definition_id===query.reference.definition_id && sameJson(first.query,query.target.query) && sameJson(second.query,query.reference.query) &&
    sameJson(first.identity,request.identity) && sameJson(second.identity,request.identity) && sameJson(first.parent_identity,second.parent_identity);
}
export const httpRecipeComparisonClient: Bpic19RecipeComparisonClient = {
  async compare(request, signal) {
    let response: Response;
    try { response = await fetch("/api/investigations/bpic19-recipe-comparison", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(request), signal, cache: "no-store" }); }
    catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let payload: unknown;
    try { payload = await response.json(); } catch { payload = undefined; }
    if (bpic19RecipeComparisonContract.refusal(payload) && (payload.request_id === null || payload.request_id === request.request_id) &&
      (payload.query_revision === null || payload.query_revision === request.query_revision) && (payload.workspace_id === null || payload.workspace_id === request.workspace_id)) return { ok: false, problem: { kind: "refusal", refusal: payload } };
    if (response.ok && bpic19RecipeComparisonContract.answer(payload) && answersRecipeComparison(request, payload)) return { ok: true, answer: payload };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The answer does not belong to this source, population and reviewed field definition." } };
  },
};
