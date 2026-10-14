import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/case-list.schema.json";
import { sameJson } from "../data/coordinator";
import { uniqueItemsHold, withoutUniqueItems } from "../data/uniqueItems";
import type { CaseListAnswer, CaseListRequest, CaseListRefusal } from "../generated/case-list";

export type CaseListProblem =
  | { kind: "refusal"; refusal: CaseListRefusal }
  | { kind: "unreachable" }
  | { kind: "unsupported_reply"; detail: string };
export type CaseListOutcome = { ok: true; answer: CaseListAnswer } | { ok: false; problem: CaseListProblem };
export interface CaseListClient {
  list(request: CaseListRequest, signal: AbortSignal): Promise<CaseListOutcome>;
}
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, formats: { "date-time": true } });
ajv.addSchema(withoutUniqueItems(schema));
function check<T>(definition: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The case-list contract has no ${definition}.`);
  return (value: unknown): value is T => validate(value) && uniqueItemsHold(schema, { $ref: `#/$defs/${definition}` }, value);
}
export const caseListContract = {
  request: check<CaseListRequest>("CaseListRequest"),
  answer: check<CaseListAnswer>("CaseListAnswer"),
  refusal: check<CaseListRefusal>("CaseListRefusal"),
};

/** A case-list reply must answer this exact identity, revision and display query. */
export function answersCaseList(request: CaseListRequest, answer: CaseListAnswer): boolean {
  return answer.request_id === request.request_id && answer.query_revision === request.query_revision &&
    answer.workspace_id === request.workspace_id && sameJson(answer.identity, request.identity) && sameJson(answer.query, request.query);
}

export const httpCaseListClient: CaseListClient = {
  async list(request, signal) {
    let response: Response;
    try {
      response = await fetch("/api/investigations/case-list", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request), signal, cache: "no-store",
      });
    } catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let value: unknown;
    try { value = await response.json(); } catch { value = undefined; }
    if (caseListContract.refusal(value) && value.operation === "case_list" &&
        (value.request_id === null || value.request_id === request.request_id) &&
        (value.query_revision === null || value.query_revision === request.query_revision) &&
        (value.workspace_id === null || value.workspace_id === request.workspace_id)) {
      return { ok: false, problem: { kind: "refusal", refusal: value } };
    }
    if (response.ok && caseListContract.answer(value) && answersCaseList(request, value)) return { ok: true, answer: value };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not answer this incident-list query and identity." } };
  },
};
