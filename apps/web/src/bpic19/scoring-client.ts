import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/bpic19-scoring.schema.json";
import type { Bpic19ReadRequest, Bpic19ScoreAnswer, Bpic19ScoreRequest, Bpic19Refusal, Bpic19ExportRequest } from "./scoring-types";

export type Bpic19Outcome = { ok: true; answer: Bpic19ScoreAnswer } | { ok: false; message: string };
export interface Bpic19Client {
  score(request: Bpic19ScoreRequest, signal: AbortSignal): Promise<Bpic19Outcome>;
  read(request: Bpic19ReadRequest, signal: AbortSignal): Promise<Bpic19Outcome>;
  export?(request: Bpic19ExportRequest, signal: AbortSignal): Promise<{ ok: true; blob: Blob } | { ok: false; message: string }>;
}
const ajv = new Ajv2020({ allErrors: true, strictTypes: false, allowUnionTypes: true });
ajv.addSchema(schema);
const answerCheck = ajv.getSchema<Bpic19ScoreAnswer>(`${schema.$id}#/$defs/Bpic19ScoreAnswer`)!;
const refusalCheck = ajv.getSchema<Bpic19Refusal>(`${schema.$id}#/$defs/Bpic19Refusal`)!;
function isAnswer(value: unknown): value is Bpic19ScoreAnswer { return answerCheck(value) === true; }
function isRefusal(value: unknown): value is Bpic19Refusal { return refusalCheck(value) === true; }
export const bpic19Contract = {
  request: ajv.getSchema<Bpic19ScoreRequest>(`${schema.$id}#/$defs/Bpic19ScoreRequest`)!,
  read: ajv.getSchema<Bpic19ReadRequest>(`${schema.$id}#/$defs/Bpic19ReadRequest`)!,
  export: ajv.getSchema<Bpic19ExportRequest>(`${schema.$id}#/$defs/Bpic19ExportRequest`)!,
  answer: isAnswer,
};
async function post(route: string, request: Bpic19ScoreRequest | Bpic19ReadRequest, signal: AbortSignal): Promise<Bpic19Outcome> {
  const check = request.message_type === "bpic19_score_request" ? bpic19Contract.request : bpic19Contract.read;
  if (check(request) !== true) return { ok: false, message: "The request does not match the BPIC19 analysis contract." };
  let response: Response;
  try {
    response = await fetch(route, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request), signal, cache: "no-store" });
  } catch {
    return { ok: false, message: "The analysis service could not be reached. Retry when it is available." };
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { return { ok: false, message: "The service returned an unreadable answer." }; }
  if (isRefusal(payload)) return { ok: false, message: payload.request_id === request.request_id && payload.query_revision === request.query_revision && payload.workspace_id === request.workspace_id ? payload.message : "The refusal belongs to another analysis request." };
  if (!response.ok) return { ok: false, message: `The analysis service returned HTTP ${response.status}.` };
  if (!isAnswer(payload)) return { ok: false, message: "The answer does not match the BPIC19 analysis contract." };
  if (payload.request_id !== request.request_id || payload.query_revision !== request.query_revision || payload.workspace_id !== request.workspace_id)
    return { ok: false, message: "The service answered another analysis request. Retry this analysis." };
  if (request.message_type === "bpic19_read_request" && payload.run_id !== request.run_id)
    return { ok: false, message: "The service returned another stored analysis run." };
  if (request.message_type === "bpic19_score_request" &&
    (payload.report.settings.view !== request.settings.view || payload.report.settings.mode !== request.settings.mode ||
     payload.report.settings.criteria_family !== request.settings.criteria_family ||
     payload.report.settings.gamma !== request.settings.gamma || payload.report.settings.volume !== request.settings.volume ||
     payload.report.settings.min_cases !== request.settings.min_cases ||
     (payload.report.settings.association_min_support ?? 1) !== (request.settings.association_min_support ?? 1) ||
     payload.report.settings.group_by.join(",") !== request.settings.group_by.join(",")))
    return { ok: false, message: "The service returned a result for different analysis settings." };
  if (request.message_type === "bpic19_score_request" &&
    (Object.keys(request.base_identity).some(key => request.base_identity[key as keyof typeof request.base_identity] !== payload.base_identity[key as keyof typeof payload.base_identity]) ||
     Object.keys(request.named_population.identity).some(key => request.named_population.identity[key as keyof typeof request.named_population.identity] !== payload.named_population.identity[key as keyof typeof payload.named_population.identity])))
    return { ok: false, message: "The service returned another source or population." };
  if (payload.definition_id && payload.definition_version_id !== payload.definition_id)
    return { ok: false, message: "The service returned inconsistent definition identities." };
  if (request.message_type === "bpic19_score_request" && payload.definition) {
    const roles = payload.definition.roles;
    if (!roles || typeof roles !== "object" || Array.isArray(roles) || Object.entries(request.roles).some(([k,v]) => (roles as Record<string, unknown>)[k] !== v))
      return { ok: false, message: "The service returned another source-role definition." };
  }
  return { ok: true, answer: payload };
}
export const localBpic19Client: Bpic19Client = {
  score: (request, signal) => post("/api/investigations/bpic19-score", request, signal),
  read: (request, signal) => post("/api/investigations/bpic19-read", request, signal),
  export: async (request, signal) => {
    if (!bpic19Contract.export(request)) return { ok: false, message: "The export request does not match the BPIC19 contract." };
    try {
      const response = await fetch("/api/investigations/bpic19-export", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request), signal, cache: "no-store" });
      if (response.ok && response.headers.get("content-type")?.startsWith("application/zip")) return { ok: true, blob: await response.blob() };
      const payload: unknown = await response.json();
      if (isRefusal(payload) && payload.request_id === request.request_id && payload.query_revision === request.query_revision && payload.workspace_id === request.workspace_id)
        return { ok: false, message: payload.message };
      return { ok: false, message: "The service could not export this stored run." };
    } catch { return { ok: false, message: "The service could not export this stored run." }; }
  },
};
