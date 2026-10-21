import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/bpic19-operators.schema.json";
import { sameJson } from "../data/coordinator";
import { uniqueItemsHold, withoutUniqueItems } from "../data/uniqueItems";
import type { Bpic19OperatorAnswer, Bpic19OperatorRefusal, Bpic19OperatorRequest } from "../generated/bpic19-operators";

export type Bpic19OperatorProblem = { kind: "refusal"; refusal: Bpic19OperatorRefusal } | { kind: "unreachable" } | { kind: "unsupported_reply"; detail: string };
export type Bpic19OperatorOutcome = { ok: true; answer: Bpic19OperatorAnswer } | { ok: false; problem: Bpic19OperatorProblem };
export interface Bpic19OperatorClient { operators(request: Bpic19OperatorRequest, signal: AbortSignal): Promise<Bpic19OperatorOutcome>; }
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(withoutUniqueItems(schema));
function check<T>(definition: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The recorded-event contract has no ${definition}.`);
  return (value: unknown): value is T => validate(value) && uniqueItemsHold(schema, { $ref: `#/$defs/${definition}` }, value);
}
export const bpic19OperatorContract = {
  request: check<Bpic19OperatorRequest>("Bpic19OperatorRequest"), answer: check<Bpic19OperatorAnswer>("Bpic19OperatorAnswer"), refusal: check<Bpic19OperatorRefusal>("Bpic19OperatorRefusal"),
};
export function answersBpic19Operators(request: Bpic19OperatorRequest, answer: Bpic19OperatorAnswer): boolean {
  const operation = request.query.recipe === null ? "bpic19_catalogue" : `bpic19_${request.query.recipe.kind}`;
  return answer.request_id === request.request_id && answer.query_revision === request.query_revision && answer.workspace_id === request.workspace_id &&
    sameJson(answer.identity, request.identity) && sameJson(answer.query, request.query) && answer.operation === operation && answer.definition_id === answer.definition.definition_id &&
    sameJson(answer.definition.recipe, request.query.recipe) && sameJson(answer.definition.roles, request.query.roles) &&
    (request.query.recipe === null || Object.values(answer.summary.case_state_counts).reduce((sum, count) => sum + count, 0) === answer.population_case_count) &&
    answer.selection_groups.every(group => group.case_count === group.case_ids.length);
}
export const httpBpic19OperatorsClient: Bpic19OperatorClient = {
  async operators(request, signal) {
    if (!bpic19OperatorContract.request(request)) return { ok: false, problem: { kind: "unsupported_reply", detail: "Review the admitted operator fields and exact label sets before requesting an answer." } };
    let response: Response;
    try { response = await fetch("/api/investigations/bpic19-operators", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(request), signal, cache: "no-store" }); }
    catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let value: unknown;
    try { value = await response.json(); } catch { value = undefined; }
    if (bpic19OperatorContract.refusal(value) && (value.request_id === null || value.request_id === request.request_id) && (value.query_revision === null || value.query_revision === request.query_revision) && (value.workspace_id === null || value.workspace_id === request.workspace_id)) return { ok: false, problem: { kind: "refusal", refusal: value } };
    if (response.ok && bpic19OperatorContract.answer(value) && answersBpic19Operators(request, value)) return { ok: true, answer: value };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not answer this source, population and declared recipe." } };
  },
};
