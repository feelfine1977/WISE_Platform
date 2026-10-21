import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/similar-sequences.schema.json";
import { sameJson } from "../data/coordinator";
import type { SimilarSequencesAnswer, SimilarSequencesRefusal, SimilarSequencesRequest } from "../generated/similar-sequences";

export type SimilarProblem =
  | { kind: "refusal"; refusal: SimilarSequencesRefusal }
  | { kind: "unreachable" }
  | { kind: "unsupported_reply"; detail: string };
export type SimilarOutcome = { ok: true; answer: SimilarSequencesAnswer } | { ok: false; problem: SimilarProblem };
export interface SimilarClient {
  similar(request: SimilarSequencesRequest, signal: AbortSignal): Promise<SimilarOutcome>;
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(schema);
function check<T>(definition: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The similar sequences contract has no ${definition}.`);
  return (value: unknown): value is T => validate(value) === true;
}
export const similarContract = {
  request: check<SimilarSequencesRequest>("SimilarSequencesRequest"),
  answer: check<SimilarSequencesAnswer>("SimilarSequencesAnswer"),
  refusal: check<SimilarSequencesRefusal>("SimilarSequencesRefusal"),
};

/** A reply must answer this exact request, revision, identity, sequence and bound: a late reply for another is not one. */
export function answersSimilar(request: SimilarSequencesRequest, answer: SimilarSequencesAnswer): boolean {
  return answer.request_id === request.request_id && answer.query_revision === request.query_revision && answer.workspace_id === request.workspace_id &&
    sameJson(answer.identity, request.identity) && sameJson(answer.anchor, request.anchor) && answer.maximum_edits === request.maximum_edits;
}

export const httpSimilarClient: SimilarClient = {
  async similar(request, signal) {
    let response: Response;
    try {
      response = await fetch("/api/investigations/similar-sequences", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request), signal, cache: "no-store",
      });
    } catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let value: unknown;
    try { value = await response.json(); } catch { value = undefined; }
    if (similarContract.refusal(value) && value.operation === "similar_sequences" &&
        (value.request_id === null || value.request_id === request.request_id) && (value.query_revision === null || value.query_revision === request.query_revision)) {
      return { ok: false, problem: { kind: "refusal", refusal: value } };
    }
    if (response.ok && similarContract.answer(value) && answersSimilar(request, value)) return { ok: true, answer: value };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not answer this sequence and identity." } };
  },
};
