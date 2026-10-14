import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/start-trend.schema.json";
import { sameJson } from "../data/coordinator";
import { uniqueItemsHold, withoutUniqueItems } from "../data/uniqueItems";
import type { StartTrendAnswer, StartTrendRefusal, StartTrendRequest } from "../generated/start-trend";

export type StartTrendProblem =
  | { kind: "refusal"; refusal: StartTrendRefusal }
  | { kind: "unreachable" }
  | { kind: "unsupported_reply"; detail: string };
export type StartTrendOutcome = { ok: true; answer: StartTrendAnswer } | { ok: false; problem: StartTrendProblem };
export interface StartTrendClient {
  trend(request: StartTrendRequest, signal: AbortSignal): Promise<StartTrendOutcome>;
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, formats: { "date-time": true } });
ajv.addSchema(withoutUniqueItems(schema));
function check<T>(definition: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The start-trend contract has no ${definition}.`);
  return (value: unknown): value is T => validate(value) && uniqueItemsHold(schema, { $ref: `#/$defs/${definition}` }, value);
}
export const startTrendContract = {
  request: check<StartTrendRequest>("StartTrendRequest"),
  answer: check<StartTrendAnswer>("StartTrendAnswer"),
  refusal: check<StartTrendRefusal>("StartTrendRefusal"),
};

/** A trend answers exactly the identity, revision and definition it was asked for. */
export function answersStartTrend(request: StartTrendRequest, answer: StartTrendAnswer): boolean {
  return answer.request_id === request.request_id && answer.query_revision === request.query_revision &&
    answer.workspace_id === request.workspace_id && sameJson(answer.identity, request.identity) && sameJson(answer.definition, request.definition);
}

export const httpStartTrendClient: StartTrendClient = {
  async trend(request, signal) {
    let response: Response;
    try {
      response = await fetch("/api/investigations/start-trend", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request), signal, cache: "no-store",
      });
    } catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let value: unknown;
    try { value = await response.json(); } catch { value = undefined; }
    if (startTrendContract.refusal(value) && value.operation === "start_trend" &&
        (value.request_id === null || value.request_id === request.request_id) &&
        (value.query_revision === null || value.query_revision === request.query_revision) &&
        (value.workspace_id === null || value.workspace_id === request.workspace_id)) {
      return { ok: false, problem: { kind: "refusal", refusal: value } };
    }
    if (response.ok && startTrendContract.answer(value) && answersStartTrend(request, value)) return { ok: true, answer: value };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not answer this trend and identity." } };
  },
};
