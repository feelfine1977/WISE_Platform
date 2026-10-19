import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/interval-tail.schema.json";
import { sameJson } from "../data/coordinator";
import type { IntervalDistributionAnswer, IntervalDistributionRefusal, IntervalDistributionRequest } from "../generated/interval-tail";

export type IntervalProblem =
  | { kind: "refusal"; refusal: IntervalDistributionRefusal }
  | { kind: "unreachable" }
  | { kind: "unsupported_reply"; detail: string };
export type IntervalOutcome = { ok: true; answer: IntervalDistributionAnswer } | { ok: false; problem: IntervalProblem };
export interface IntervalClient {
  distribution(request: IntervalDistributionRequest, signal: AbortSignal): Promise<IntervalOutcome>;
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(schema);
function check<T>(definition: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The interval contract has no ${definition}.`);
  return (value: unknown): value is T => validate(value) === true;
}
export const intervalContract = {
  request: check<IntervalDistributionRequest>("IntervalDistributionRequest"),
  answer: check<IntervalDistributionAnswer>("IntervalDistributionAnswer"),
  refusal: check<IntervalDistributionRefusal>("IntervalDistributionRefusal"),
};

/** An interval reply must answer this exact identity, revision, interval and edges. */
export function answersInterval(request: IntervalDistributionRequest, answer: IntervalDistributionAnswer): boolean {
  return answer.request_id === request.request_id && answer.query_revision === request.query_revision && answer.workspace_id === request.workspace_id &&
    sameJson(answer.identity, request.identity) && sameJson(answer.interval, request.interval) && sameJson(answer.edges_hours, request.edges_hours);
}

export const httpIntervalClient: IntervalClient = {
  async distribution(request, signal) {
    let response: Response;
    try {
      response = await fetch("/api/investigations/interval-distribution", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request), signal, cache: "no-store",
      });
    } catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let value: unknown;
    try { value = await response.json(); } catch { value = undefined; }
    if (intervalContract.refusal(value) && value.operation === "interval_distribution" &&
        (value.request_id === null || value.request_id === request.request_id) && (value.query_revision === null || value.query_revision === request.query_revision)) {
      return { ok: false, problem: { kind: "refusal", refusal: value } };
    }
    if (response.ok && intervalContract.answer(value) && answersInterval(request, value)) return { ok: true, answer: value };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not answer this interval and identity." } };
  },
};
