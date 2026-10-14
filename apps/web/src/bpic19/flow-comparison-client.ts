import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/bpic19-flow-comparison.schema.json";
import { sameJson } from "../data/coordinator";
import { uniqueItemsHold, withoutUniqueItems } from "../data/uniqueItems";
import type { Bpic19FlowComparisonAnswer, Bpic19FlowComparisonRefusal, Bpic19FlowComparisonRequest } from "../generated/bpic19-flow-comparison";

export type Bpic19FlowComparisonProblem =
  | { kind: "refusal"; refusal: Bpic19FlowComparisonRefusal }
  | { kind: "unreachable" }
  | { kind: "unsupported_reply"; detail: string };
export type Bpic19FlowComparisonOutcome = { ok: true; answer: Bpic19FlowComparisonAnswer } | { ok: false; problem: Bpic19FlowComparisonProblem };
export interface Bpic19FlowComparisonClient {
  compare(request: Bpic19FlowComparisonRequest, signal: AbortSignal): Promise<Bpic19FlowComparisonOutcome>;
}
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(withoutUniqueItems(schema));
function check<T>(name: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`Missing BPIC19 boundary ${name}`);
  return (value: unknown): value is T => validate(value) && uniqueItemsHold(schema, { $ref: `#/$defs/${name}` }, value);
}
export const bpic19FlowComparisonContract = {
  request: check<Bpic19FlowComparisonRequest>("Bpic19FlowComparisonRequest"), answer: check<Bpic19FlowComparisonAnswer>("Bpic19FlowComparisonAnswer"), refusal: check<Bpic19FlowComparisonRefusal>("Bpic19FlowComparisonRefusal"),
};
export function answersFlowComparison(request: Bpic19FlowComparisonRequest, answer: Bpic19FlowComparisonAnswer): boolean {
  return request.request_id === answer.request_id && request.query_revision === answer.query_revision && request.workspace_id === answer.workspace_id &&
    sameJson(request.identity, answer.identity) && sameJson(request.query, answer.query) && answer.definition_id === answer.comparison.definition_id && sameJson(answer.definition, answer.comparison.definition);
}
export const httpFlowComparisonClient: Bpic19FlowComparisonClient = {
  async compare(request, signal) {
    let response: Response;
    try { response = await fetch("/api/investigations/bpic19-flow-comparison", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(request), signal, cache: "no-store" }); }
    catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let payload: unknown;
    try { payload = await response.json(); } catch { payload = undefined; }
    if (bpic19FlowComparisonContract.refusal(payload) && (payload.request_id === null || payload.request_id === request.request_id) &&
      (payload.query_revision === null || payload.query_revision === request.query_revision) && (payload.workspace_id === null || payload.workspace_id === request.workspace_id)) return { ok: false, problem: { kind: "refusal", refusal: payload } };
    if (response.ok && bpic19FlowComparisonContract.answer(payload) && answersFlowComparison(request, payload)) return { ok: true, answer: payload };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The answer does not belong to this source, population and reviewed field definition." } };
  },
};
