import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/gap-pairs.schema.json";
import { sameJson } from "../data/coordinator";
import type { GapPairsAnswer, GapPairsRefusal, GapPairsRequest } from "../generated/gap-pairs";

export type GapsProblem =
  | { kind: "refusal"; refusal: GapPairsRefusal }
  | { kind: "unreachable" }
  | { kind: "unsupported_reply"; detail: string };
export type GapsOutcome = { ok: true; answer: GapPairsAnswer } | { ok: false; problem: GapsProblem };
export interface GapsClient {
  gaps(request: GapPairsRequest, signal: AbortSignal): Promise<GapsOutcome>;
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(schema);
function check<T>(definition: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The gap pairs contract has no ${definition}.`);
  return (value: unknown): value is T => validate(value) === true;
}
export const gapsContract = {
  request: check<GapPairsRequest>("GapPairsRequest"),
  answer: check<GapPairsAnswer>("GapPairsAnswer"),
  refusal: check<GapPairsRefusal>("GapPairsRefusal"),
};

/** A reply must answer this exact request, revision, identity and relation: a late reply for another choice is not one. */
export function answersGaps(request: GapPairsRequest, answer: GapPairsAnswer): boolean {
  return answer.request_id === request.request_id && answer.query_revision === request.query_revision && answer.workspace_id === request.workspace_id &&
    sameJson(answer.identity, request.identity) && answer.relation === request.relation && answer.threshold_hours === request.threshold_hours &&
    (request.chosen === null ? answer.chosen === null : answer.chosen !== null &&
      answer.chosen.from_activity === request.chosen.from_activity && answer.chosen.to_activity === request.chosen.to_activity &&
      answer.chosen.case_offset === (request.case_offset ?? 0) && answer.chosen.cases.length <= request.case_limit);
}

export const httpGapsClient: GapsClient = {
  async gaps(request, signal) {
    let response: Response;
    try {
      response = await fetch("/api/investigations/gap-pairs", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request), signal, cache: "no-store",
      });
    } catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let value: unknown;
    try { value = await response.json(); } catch { value = undefined; }
    if (gapsContract.refusal(value) && value.operation === "gap_pairs" &&
        (value.request_id === null || value.request_id === request.request_id) && (value.query_revision === null || value.query_revision === request.query_revision)) {
      return { ok: false, problem: { kind: "refusal", refusal: value } };
    }
    if (response.ok && gapsContract.answer(value) && answersGaps(request, value)) return { ok: true, answer: value };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not answer these gaps and identity." } };
  },
};
