import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/unanswered-requests.schema.json";
import { sameJson } from "../data/coordinator";
import type { UnansweredRequestsAnswer, UnansweredRequestsRefusal, UnansweredRequestsRequest } from "../generated/unanswered-requests";

export type RequestsProblem =
  | { kind: "refusal"; refusal: UnansweredRequestsRefusal }
  | { kind: "unreachable" }
  | { kind: "unsupported_reply"; detail: string };
export type RequestsOutcome = { ok: true; answer: UnansweredRequestsAnswer } | { ok: false; problem: RequestsProblem };
export interface RequestsClient {
  unanswered(request: UnansweredRequestsRequest, signal: AbortSignal): Promise<RequestsOutcome>;
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(schema);
function check<T>(definition: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The unanswered requests contract has no ${definition}.`);
  return (value: unknown): value is T => validate(value) === true;
}
export const requestsContract = {
  request: check<UnansweredRequestsRequest>("UnansweredRequestsRequest"),
  answer: check<UnansweredRequestsAnswer>("UnansweredRequestsAnswer"),
  refusal: check<UnansweredRequestsRefusal>("UnansweredRequestsRefusal"),
};

/** A reply must answer this exact request, revision, identity and definition: a late reply for another definition is not one. */
export function answersRequests(request: UnansweredRequestsRequest, answer: UnansweredRequestsAnswer): boolean {
  return answer.request_id === request.request_id && answer.query_revision === request.query_revision && answer.workspace_id === request.workspace_id &&
    sameJson(answer.identity, request.identity) && sameJson(answer.definition, request.definition);
}

export const httpRequestsClient: RequestsClient = {
  async unanswered(request, signal) {
    let response: Response;
    try {
      response = await fetch("/api/investigations/unanswered-requests", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request), signal, cache: "no-store",
      });
    } catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let value: unknown;
    try { value = await response.json(); } catch { value = undefined; }
    if (requestsContract.refusal(value) && value.operation === "unanswered_requests" &&
        (value.request_id === null || value.request_id === request.request_id) && (value.query_revision === null || value.query_revision === request.query_revision)) {
      return { ok: false, problem: { kind: "refusal", refusal: value } };
    }
    if (response.ok && requestsContract.answer(value) && answersRequests(request, value)) return { ok: true, answer: value };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not answer this definition and identity." } };
  },
};
