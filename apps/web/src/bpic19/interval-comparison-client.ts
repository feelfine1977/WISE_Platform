import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/bpic19-interval-comparison.schema.json";
import { sameJson } from "../data/coordinator";
import { uniqueItemsHold, withoutUniqueItems } from "../data/uniqueItems";
import type { Bpic19IntervalComparisonAnswer, Bpic19IntervalComparisonRefusal, Bpic19IntervalComparisonRequest } from "../generated/bpic19-interval-comparison";

export type Bpic19IntervalComparisonProblem =
  | { kind: "refusal"; refusal: Bpic19IntervalComparisonRefusal }
  | { kind: "unreachable" }
  | { kind: "unsupported_reply"; detail: string };
export type Bpic19IntervalComparisonOutcome = { ok: true; answer: Bpic19IntervalComparisonAnswer } | { ok: false; problem: Bpic19IntervalComparisonProblem };
export interface Bpic19IntervalComparisonClient {
  compare(request: Bpic19IntervalComparisonRequest, signal: AbortSignal): Promise<Bpic19IntervalComparisonOutcome>;
}
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(withoutUniqueItems(schema));
function check<T>(name: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`Missing BPIC19 boundary ${name}`);
  return (value: unknown): value is T => validate(value) && uniqueItemsHold(schema, { $ref: `#/$defs/${name}` }, value);
}
export const bpic19IntervalComparisonContract = {
  request: check<Bpic19IntervalComparisonRequest>("Bpic19IntervalComparisonRequest"), answer: check<Bpic19IntervalComparisonAnswer>("Bpic19IntervalComparisonAnswer"), refusal: check<Bpic19IntervalComparisonRefusal>("Bpic19IntervalComparisonRefusal"),
};
export function answersIntervalComparison(request: Bpic19IntervalComparisonRequest, answer: Bpic19IntervalComparisonAnswer): boolean {
  return request.request_id === answer.request_id && request.query_revision === answer.query_revision && request.workspace_id === answer.workspace_id &&
    sameJson(request.identity, answer.identity) && sameJson(request.query, answer.query) && answer.definition_id === answer.comparison.definition_id && sameJson(answer.definition, answer.comparison.definition);
}
export const httpIntervalComparisonClient: Bpic19IntervalComparisonClient = {
  async compare(request, signal) {
    let response: Response;
    try { response = await fetch("/api/investigations/bpic19-interval-comparison", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(request), signal, cache: "no-store" }); }
    catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let payload: unknown;
    try { payload = await response.json(); } catch { payload = undefined; }
    if (bpic19IntervalComparisonContract.refusal(payload) && (payload.request_id === null || payload.request_id === request.request_id) &&
      (payload.query_revision === null || payload.query_revision === request.query_revision) && (payload.workspace_id === null || payload.workspace_id === request.workspace_id)) return { ok: false, problem: { kind: "refusal", refusal: payload } };
    if (response.ok && bpic19IntervalComparisonContract.answer(payload) && answersIntervalComparison(request, payload)) return { ok: true, answer: payload };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The answer does not belong to this source, population and reviewed field definition." } };
  },
};
