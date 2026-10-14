import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/bpic19-profile.schema.json";
import { sameJson } from "../data/coordinator";
import { uniqueItemsHold, withoutUniqueItems } from "../data/uniqueItems";
import type { Bpic19ProfileAnswer, Bpic19ProfileRefusal, Bpic19ProfileRequest } from "../generated/bpic19-profile";

export type Bpic19ProfileProblem =
  | { kind: "refusal"; refusal: Bpic19ProfileRefusal }
  | { kind: "unreachable" }
  | { kind: "unsupported_reply"; detail: string };
export type Bpic19ProfileOutcome = { ok: true; answer: Bpic19ProfileAnswer } | { ok: false; problem: Bpic19ProfileProblem };
export interface Bpic19ProfileClient {
  profile(request: Bpic19ProfileRequest, signal: AbortSignal): Promise<Bpic19ProfileOutcome>;
}
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(withoutUniqueItems(schema));
function check<T>(name: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`Missing BPIC19 boundary ${name}`);
  return (value: unknown): value is T => validate(value) && uniqueItemsHold(schema, { $ref: `#/$defs/${name}` }, value);
}
export const bpic19ProfileContract = {
  request: check<Bpic19ProfileRequest>("Bpic19ProfileRequest"), answer: check<Bpic19ProfileAnswer>("Bpic19ProfileAnswer"), refusal: check<Bpic19ProfileRefusal>("Bpic19ProfileRefusal"),
};
export function answersBpic19Profile(request: Bpic19ProfileRequest, answer: Bpic19ProfileAnswer): boolean {
  return request.request_id === answer.request_id && request.query_revision === answer.query_revision && request.workspace_id === answer.workspace_id &&
    sameJson(request.identity, answer.identity) && sameJson(request.query, answer.query) && (answer.binding_state === "reviewed") === (answer.profile !== null);
}
export const httpBpic19ProfileClient: Bpic19ProfileClient = {
  async profile(request, signal) {
    let response: Response;
    try { response = await fetch("/api/investigations/bpic19-profile", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(request), signal, cache: "no-store" }); }
    catch { return { ok: false, problem: { kind: "unreachable" } }; }
    let payload: unknown;
    try { payload = await response.json(); } catch { payload = undefined; }
    if (bpic19ProfileContract.refusal(payload) && (payload.request_id === null || payload.request_id === request.request_id) &&
      (payload.query_revision === null || payload.query_revision === request.query_revision) && (payload.workspace_id === null || payload.workspace_id === request.workspace_id)) return { ok: false, problem: { kind: "refusal", refusal: payload } };
    if (response.ok && bpic19ProfileContract.answer(payload) && answersBpic19Profile(request, payload)) return { ok: true, answer: payload };
    return { ok: false, problem: { kind: "unsupported_reply", detail: "The answer does not belong to this source, population and reviewed field definition." } };
  },
};
