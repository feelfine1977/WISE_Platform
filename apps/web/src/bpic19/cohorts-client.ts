import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/bpic19-cohorts.schema.json";
import { sameJson } from "../data/coordinator";
import { uniqueItemsHold, withoutUniqueItems } from "../data/uniqueItems";
import type { Bpic19CohortsRequest, Bpic19CohortsAnswer, Bpic19CohortsRefusal } from "../generated/bpic19-cohorts";

export type CohortsOutcome = { ok: true; answer: Bpic19CohortsAnswer } | { ok: false; problem: { kind: "refusal"; refusal: Bpic19CohortsRefusal } | { kind: "unreachable" } | { kind: "unsupported_reply"; detail: string } };
export interface CohortsClient { cohorts(request: Bpic19CohortsRequest, signal: AbortSignal): Promise<CohortsOutcome> }
const ajv = new Ajv2020({ allErrors: true });
ajv.addSchema(withoutUniqueItems(schema));
function check<T>(name: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`Missing cohort boundary ${name}`);
  return (value: unknown): value is T => validate(value) === true && uniqueItemsHold(schema, { $ref: `#/$defs/${name}` }, value);
}
export const cohortsContract = { request: check<Bpic19CohortsRequest>("Bpic19CohortsRequest"), answer: check<Bpic19CohortsAnswer>("Bpic19CohortsAnswer"), refusal: check<Bpic19CohortsRefusal>("Bpic19CohortsRefusal") };
export function answersCohorts(request: Bpic19CohortsRequest, answer: Bpic19CohortsAnswer): boolean {
  const { page: _page, ...definition } = request.query;
  return answer.request_id === request.request_id && answer.query_revision === request.query_revision && answer.workspace_id === request.workspace_id && sameJson(answer.identity, request.identity) && sameJson(answer.query, request.query) && answer.definition_id === answer.cohorts.definition_id && sameJson(answer.definition, answer.cohorts.definition) && sameJson(definition, answer.definition);
}
export const httpCohortsClient: CohortsClient = {
  async cohorts(request, signal) {
    let response: Response;
    try { response = await fetch("/api/investigations/bpic19-cohorts", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(request), signal, cache: "no-store" }); }
    catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let payload: unknown;
    try { payload = await response.json(); } catch { payload = undefined; }
    if (cohortsContract.refusal(payload) && (payload.request_id === null || payload.request_id === request.request_id) && (payload.query_revision === null || payload.query_revision === request.query_revision) && (payload.workspace_id === null || payload.workspace_id === request.workspace_id)) return { ok: false, problem: { kind: "refusal", refusal: payload } };
    if (response.ok && cohortsContract.answer(payload) && answersCohorts(request, payload)) return { ok: true, answer: payload };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The cohort answer does not belong to the current source, population and reviewed recipe." } };
  },
};
