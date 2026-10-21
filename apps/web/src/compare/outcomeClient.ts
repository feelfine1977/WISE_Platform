import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/outcome.schema.json";
import { sameJson } from "../data/coordinator";
import type { OutcomeRatesAnswer, OutcomeRatesRefusal, OutcomeRatesRequest } from "../generated/outcome";

export type OutcomeProblem =
  | { kind: "refusal"; refusal: OutcomeRatesRefusal }
  | { kind: "unreachable" }
  | { kind: "unsupported_reply"; detail: string };
export type OutcomeOutcome = { ok: true; answer: OutcomeRatesAnswer } | { ok: false; problem: OutcomeProblem };
export interface OutcomeClient {
  rates(request: OutcomeRatesRequest, signal: AbortSignal): Promise<OutcomeOutcome>;
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(schema);
function check<T>(definition: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The outcome contract has no ${definition}.`);
  return (value: unknown): value is T => validate(value) === true;
}
export const outcomeContract = {
  request: check<OutcomeRatesRequest>("OutcomeRatesRequest"),
  answer: check<OutcomeRatesAnswer>("OutcomeRatesAnswer"),
  refusal: check<OutcomeRatesRefusal>("OutcomeRatesRefusal"),
};

/** An outcome reply must answer this exact request, revision, identity and outcome. */
export function answersOutcome(request: OutcomeRatesRequest, answer: OutcomeRatesAnswer): boolean {
  return answer.request_id === request.request_id && answer.query_revision === request.query_revision && answer.workspace_id === request.workspace_id &&
    sameJson(answer.identity, request.identity) && sameJson(answer.outcome, request.outcome) && answer.context_column_index === request.context_column_index;
}

export const httpOutcomeClient: OutcomeClient = {
  async rates(request, signal) {
    let response: Response;
    try {
      response = await fetch("/api/investigations/outcome-rates", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request), signal, cache: "no-store",
      });
    } catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let value: unknown;
    try { value = await response.json(); } catch { value = undefined; }
    if (outcomeContract.refusal(value) && value.operation === "outcome_rates" &&
        (value.request_id === null || value.request_id === request.request_id) && (value.query_revision === null || value.query_revision === request.query_revision)) {
      return { ok: false, problem: { kind: "refusal", refusal: value } };
    }
    if (response.ok && outcomeContract.answer(value) && answersOutcome(request, value)) return { ok: true, answer: value };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not answer this outcome and identity." } };
  },
};
