import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/bpic19-measures.schema.json";
import { sameJson } from "../data/coordinator";
import { uniqueItemsHold, withoutUniqueItems } from "../data/uniqueItems";
import type { Bpic19MeasuresAnswer, Bpic19MeasuresRefusal, Bpic19MeasuresRequest } from "../generated/bpic19-measures";

export type Bpic19MeasuresProblem =
  | { kind: "refusal"; refusal: Bpic19MeasuresRefusal }
  | { kind: "unreachable" }
  | { kind: "unsupported_reply"; detail: string };
export type Bpic19MeasuresOutcome = { ok: true; answer: Bpic19MeasuresAnswer } | { ok: false; problem: Bpic19MeasuresProblem };
export interface Bpic19MeasuresClient {
  measures(request: Bpic19MeasuresRequest, signal: AbortSignal): Promise<Bpic19MeasuresOutcome>;
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(withoutUniqueItems(schema));
function check<T>(definition: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The BPIC19 measures contract has no ${definition}.`);
  return (value: unknown): value is T => validate(value) && uniqueItemsHold(schema, { $ref: `#/$defs/${definition}` }, value);
}
export const bpic19MeasuresContract = {
  request: check<Bpic19MeasuresRequest>("Bpic19MeasuresRequest"),
  answer: check<Bpic19MeasuresAnswer>("Bpic19MeasuresAnswer"),
  refusal: check<Bpic19MeasuresRefusal>("Bpic19MeasuresRefusal"),
};

export function answersBpic19Measures(request: Bpic19MeasuresRequest, answer: Bpic19MeasuresAnswer): boolean {
  return answer.request_id === request.request_id && answer.query_revision === request.query_revision &&
    answer.workspace_id === request.workspace_id && sameJson(answer.identity, request.identity) && sameJson(answer.query, request.query);
}

export const httpBpic19MeasuresClient: Bpic19MeasuresClient = {
  async measures(request, signal) {
    if (!bpic19MeasuresContract.request(request)) return { ok: false, problem: { kind: "unsupported_reply", detail: "Review the supported measure fields before requesting this answer." } };
    let response: Response;
    try {
      response = await fetch("/api/investigations/bpic19-measures", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request), signal, cache: "no-store" });
    } catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let value: unknown;
    try { value = await response.json(); } catch { value = undefined; }
    if (bpic19MeasuresContract.refusal(value) && (value.request_id === null || value.request_id === request.request_id) &&
        (value.query_revision === null || value.query_revision === request.query_revision) && (value.workspace_id === null || value.workspace_id === request.workspace_id)) {
      return { ok: false, problem: { kind: "refusal", refusal: value } };
    }
    if (response.ok && bpic19MeasuresContract.answer(value) && answersBpic19Measures(request, value)) return { ok: true, answer: value };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not answer these measures, source identity and population." } };
  },
};
