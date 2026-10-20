import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/record-marks.schema.json";
import { sameJson } from "../data/coordinator";
import type { RecordMarksAnswer, RecordMarksRefusal, RecordMarksRequest } from "../generated/record-marks";

export type MarksProblem =
  | { kind: "refusal"; refusal: RecordMarksRefusal }
  | { kind: "unreachable" }
  | { kind: "unsupported_reply"; detail: string };
export type MarksOutcome = { ok: true; answer: RecordMarksAnswer } | { ok: false; problem: MarksProblem };
export interface MarksClient {
  marks(request: RecordMarksRequest, signal: AbortSignal): Promise<MarksOutcome>;
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(schema);
function check<T>(definition: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The record marks contract has no ${definition}.`);
  return (value: unknown): value is T => validate(value) === true;
}
export const marksContract = {
  request: check<RecordMarksRequest>("RecordMarksRequest"),
  answer: check<RecordMarksAnswer>("RecordMarksAnswer"),
  refusal: check<RecordMarksRefusal>("RecordMarksRefusal"),
};

/** A reply must answer this exact request, revision, identity and incidents: a late reply for other incidents is not one. */
export function answersMarks(request: RecordMarksRequest, answer: RecordMarksAnswer): boolean {
  return answer.request_id === request.request_id && answer.query_revision === request.query_revision && answer.workspace_id === request.workspace_id &&
    sameJson(answer.identity, request.identity) && sameJson(answer.cases.map((item) => item.case_id), request.case_ids);
}

export const httpMarksClient: MarksClient = {
  async marks(request, signal) {
    let response: Response;
    try {
      response = await fetch("/api/investigations/record-marks", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request), signal, cache: "no-store",
      });
    } catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let value: unknown;
    try { value = await response.json(); } catch { value = undefined; }
    if (marksContract.refusal(value) && value.operation === "record_marks" &&
        (value.request_id === null || value.request_id === request.request_id) && (value.query_revision === null || value.query_revision === request.query_revision)) {
      return { ok: false, problem: { kind: "refusal", refusal: value } };
    }
    if (response.ok && marksContract.answer(value) && answersMarks(request, value)) return { ok: true, answer: value };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not answer these incidents and identity." } };
  },
};
