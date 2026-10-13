import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import investigationSchema from "../../../../contracts/investigation.schema.json";
import type {
  CaseEvidenceAnswer,
  CaseEvidenceRequest,
  OpenExampleRequest,
  PopulationAnswer,
  Refusal,
} from "../generated/investigation";

export const openExampleRoute = "/api/investigations/open-example";
export const caseEvidenceRoute = "/api/investigations/case-evidence";

/**
 * Why a request produced no answer: a typed refusal from the local service, or a failure this
 * screen detected (no connection, an operation the service does not offer, or a reply outside
 * the contract). It is always shown as a failure, never as an empty answer.
 */
export type Problem =
  | { kind: "refusal"; refusal: Refusal }
  | { kind: "unreachable" }
  | { kind: "http"; status: number }
  | { kind: "unsupported_reply"; detail: string };

export type Outcome<T> = { ok: true; answer: T } | { ok: false; problem: Problem };

export interface InvestigationClient {
  openExample(request: OpenExampleRequest, signal: AbortSignal): Promise<Outcome<PopulationAnswer>>;
  caseEvidence(request: CaseEvidenceRequest, signal: AbortSignal): Promise<Outcome<CaseEvidenceAnswer>>;
}

// UTC instants are also constrained by a pattern, so the format keyword adds no check here.
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, formats: { "date-time": true } });
ajv.addSchema(investigationSchema);

function validator<T>(definition: string): ValidateFunction<T> {
  const validate = ajv.getSchema<T>(`${investigationSchema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The investigation contract has no definition ${definition}.`);
  return validate;
}

export const contract = {
  populationAnswer: validator<PopulationAnswer>("PopulationAnswer"),
  caseEvidenceAnswer: validator<CaseEvidenceAnswer>("CaseEvidenceAnswer"),
  refusal: validator<Refusal>("Refusal"),
  openExampleRequest: validator<OpenExampleRequest>("OpenExampleRequest"),
  caseEvidenceRequest: validator<CaseEvidenceRequest>("CaseEvidenceRequest"),
};

async function post<T>(
  route: string,
  body: unknown,
  operation: Refusal["operation"],
  validateAnswer: ValidateFunction<T>,
  signal: AbortSignal,
): Promise<Outcome<T>> {
  let response: Response;
  try {
    response = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch {
    return { ok: false, problem: { kind: "unreachable" } };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  if (contract.refusal(payload) && payload.operation === operation) {
    return { ok: false, problem: { kind: "refusal", refusal: payload } };
  }
  if (!response.ok) return { ok: false, problem: { kind: "http", status: response.status } };
  if (validateAnswer(payload)) return { ok: true, answer: payload };
  return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not match the investigation contract." } };
}

export const httpInvestigationClient: InvestigationClient = {
  openExample: (request, signal) => post(openExampleRoute, request, "open_example", contract.populationAnswer, signal),
  caseEvidence: (request, signal) => post(caseEvidenceRoute, request, "case_evidence", contract.caseEvidenceAnswer, signal),
};
