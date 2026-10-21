import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/numeric-context.schema.json";
import { sameJson } from "../data/coordinator";
import type { NumericContextAnswer, NumericContextRefusal, NumericContextRequest } from "../generated/numeric-context";

export type NumbersProblem =
  | { kind: "refusal"; refusal: NumericContextRefusal }
  | { kind: "unreachable" }
  | { kind: "unsupported_reply"; detail: string };
export type NumbersOutcome = { ok: true; answer: NumericContextAnswer } | { ok: false; problem: NumbersProblem };
export interface NumbersClient {
  numbers(request: NumericContextRequest, signal: AbortSignal): Promise<NumbersOutcome>;
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(schema);
function check<T>(definition: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The numeric context contract has no ${definition}.`);
  return (value: unknown): value is T => validate(value) === true;
}
export const numbersContract = {
  request: check<NumericContextRequest>("NumericContextRequest"),
  answer: check<NumericContextAnswer>("NumericContextAnswer"),
  refusal: check<NumericContextRefusal>("NumericContextRefusal"),
};

/** A reply must answer this exact request, revision, identity, column and projection: a late reply for another choice is not one. */
export function answersNumbers(request: NumericContextRequest, answer: NumericContextAnswer): boolean {
  return answer.request_id === request.request_id && answer.query_revision === request.query_revision && answer.workspace_id === request.workspace_id &&
    sameJson(answer.identity, request.identity) && answer.column_index === request.column_index && answer.projection === request.projection;
}

export const httpNumbersClient: NumbersClient = {
  async numbers(request, signal) {
    let response: Response;
    try {
      response = await fetch("/api/investigations/numeric-context", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request), signal, cache: "no-store",
      });
    } catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let value: unknown;
    try { value = await response.json(); } catch { value = undefined; }
    if (numbersContract.refusal(value) && value.operation === "numeric_context" &&
        (value.request_id === null || value.request_id === request.request_id) && (value.query_revision === null || value.query_revision === request.query_revision)) {
      return { ok: false, problem: { kind: "refusal", refusal: value } };
    }
    if (response.ok && numbersContract.answer(value) && answersNumbers(request, value)) return { ok: true, answer: value };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not answer these numbers and identity." } };
  },
};
