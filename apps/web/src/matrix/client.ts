import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/transition-matrix.schema.json";
import { sameJson } from "../data/coordinator";
import type { TransitionMatrixAnswer, TransitionMatrixRefusal, TransitionMatrixRequest } from "../generated/transition-matrix";

export type MatrixProblem =
  | { kind: "refusal"; refusal: TransitionMatrixRefusal }
  | { kind: "unreachable" }
  | { kind: "unsupported_reply"; detail: string };
export type MatrixOutcome = { ok: true; answer: TransitionMatrixAnswer } | { ok: false; problem: MatrixProblem };
export interface MatrixClient {
  matrix(request: TransitionMatrixRequest, signal: AbortSignal): Promise<MatrixOutcome>;
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(schema);
function check<T>(definition: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The transition matrix contract has no ${definition}.`);
  return (value: unknown): value is T => validate(value) === true;
}
export const matrixContract = {
  request: check<TransitionMatrixRequest>("TransitionMatrixRequest"),
  answer: check<TransitionMatrixAnswer>("TransitionMatrixAnswer"),
  refusal: check<TransitionMatrixRefusal>("TransitionMatrixRefusal"),
};

/** A matrix reply must answer this exact request, revision and identity: a late reply for another selection is not one. */
export function answersMatrix(request: TransitionMatrixRequest, answer: TransitionMatrixAnswer): boolean {
  return answer.request_id === request.request_id && answer.query_revision === request.query_revision && answer.workspace_id === request.workspace_id &&
    sameJson(answer.identity, request.identity);
}

export const httpMatrixClient: MatrixClient = {
  async matrix(request, signal) {
    let response: Response;
    try {
      response = await fetch("/api/investigations/transition-matrix", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request), signal, cache: "no-store",
      });
    } catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let value: unknown;
    try { value = await response.json(); } catch { value = undefined; }
    if (matrixContract.refusal(value) && value.operation === "transition_matrix" &&
        (value.request_id === null || value.request_id === request.request_id) && (value.query_revision === null || value.query_revision === request.query_revision)) {
      return { ok: false, problem: { kind: "refusal", refusal: value } };
    }
    if (response.ok && matrixContract.answer(value) && answersMatrix(request, value)) return { ok: true, answer: value };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not answer this matrix and identity." } };
  },
};
