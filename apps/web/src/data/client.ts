import Ajv2020 from "ajv/dist/2020.js";
import importSchema from "../../../../contracts/import.schema.json";
import type {
  ConfirmMappingRequest,
  CsvInspectionAnswer,
  ImportedCaseEvidenceAnswer,
  ImportedCaseEvidenceRequest,
  ImportedPopulationAnswer,
  ImportRefusal,
  InspectCsvRequest,
  InterpretationAnswer,
  OpenPopulationRequest,
  OpenWorkspaceRequest,
  SourceAnswer,
  UploadSourceMetadata,
  WorkspaceAnswer,
} from "../generated/imports";
import { uniqueItemsHold, withoutUniqueItems } from "./uniqueItems";

export const routes = {
  openWorkspace: "/api/workspaces/open",
  sources: "/api/sources",
  inspect: "/api/sources/inspect",
  preparations: "/api/preparations",
  openPopulation: "/api/investigations/open-population",
  caseEvidence: "/api/investigations/case-evidence",
} as const;

/**
 * Why an import request produced no answer: a typed refusal from the local service, or a failure
 * this screen detected. It is always shown as a failure, never as an empty answer.
 */
export type ImportProblem =
  | { kind: "refusal"; refusal: ImportRefusal }
  | { kind: "unreachable" }
  | { kind: "http"; status: number }
  | { kind: "unsupported_reply"; detail: string };

export type ImportOutcome<T> = { ok: true; answer: T } | { ok: false; problem: ImportProblem };

export interface ImportClient {
  openWorkspace(request: OpenWorkspaceRequest, signal: AbortSignal): Promise<ImportOutcome<WorkspaceAnswer>>;
  /** Sends the file's bytes unchanged; the file is never read into the page. */
  uploadSource(metadata: UploadSourceMetadata, file: Blob, signal: AbortSignal): Promise<ImportOutcome<SourceAnswer>>;
  inspect(request: InspectCsvRequest, signal: AbortSignal): Promise<ImportOutcome<CsvInspectionAnswer>>;
  confirmMapping(request: ConfirmMappingRequest, signal: AbortSignal): Promise<ImportOutcome<InterpretationAnswer>>;
  openPopulation(request: OpenPopulationRequest, signal: AbortSignal): Promise<ImportOutcome<ImportedPopulationAnswer>>;
  caseEvidence(request: ImportedCaseEvidenceRequest, signal: AbortSignal): Promise<ImportOutcome<ImportedCaseEvidenceAnswer>>;
}

/** Whether a value is a message of one definition of the import contract. */
export type ContractCheck<T> = (value: unknown) => value is T;

// UTC instants are also constrained by a pattern, so the format keyword adds no check here.
// Duplicate items are checked separately, in one pass, so that large populations stay quick.
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, formats: { "date-time": true } });
ajv.addSchema(withoutUniqueItems(importSchema));

function validator<T>(definition: string): ContractCheck<T> {
  const validate = ajv.getSchema<T>(`${importSchema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The import contract has no definition ${definition}.`);
  const reference = { $ref: `#/$defs/${definition}` };
  return (value: unknown): value is T => validate(value) && uniqueItemsHold(importSchema, reference, value);
}

export const importContract = {
  workspaceAnswer: validator<WorkspaceAnswer>("WorkspaceAnswer"),
  sourceAnswer: validator<SourceAnswer>("SourceAnswer"),
  inspectionAnswer: validator<CsvInspectionAnswer>("CsvInspectionAnswer"),
  interpretationAnswer: validator<InterpretationAnswer>("InterpretationAnswer"),
  populationAnswer: validator<ImportedPopulationAnswer>("ImportedPopulationAnswer"),
  caseEvidenceAnswer: validator<ImportedCaseEvidenceAnswer>("ImportedCaseEvidenceAnswer"),
  refusal: validator<ImportRefusal>("ImportRefusal"),
  openWorkspaceRequest: validator<OpenWorkspaceRequest>("OpenWorkspaceRequest"),
  uploadSourceMetadata: validator<UploadSourceMetadata>("UploadSourceMetadata"),
  inspectRequest: validator<InspectCsvRequest>("InspectCsvRequest"),
  confirmMappingRequest: validator<ConfirmMappingRequest>("ConfirmMappingRequest"),
  openPopulationRequest: validator<OpenPopulationRequest>("OpenPopulationRequest"),
  caseEvidenceRequest: validator<ImportedCaseEvidenceRequest>("ImportedCaseEvidenceRequest"),
};

async function send<T>(
  route: string,
  init: RequestInit,
  operation: ImportRefusal["operation"],
  validateAnswer: ContractCheck<T>,
): Promise<ImportOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(route, { ...init, cache: "no-store" });
  } catch {
    return { ok: false, problem: { kind: "unreachable" } };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  if (importContract.refusal(payload) && payload.operation === operation) {
    return { ok: false, problem: { kind: "refusal", refusal: payload } };
  }
  if (!response.ok) return { ok: false, problem: { kind: "http", status: response.status } };
  if (validateAnswer(payload)) return { ok: true, answer: payload };
  return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not match the import contract." } };
}

function postJson<T>(
  route: string,
  body: unknown,
  operation: ImportRefusal["operation"],
  validateAnswer: ContractCheck<T>,
  signal: AbortSignal,
): Promise<ImportOutcome<T>> {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal,
  };
  return send(route, init, operation, validateAnswer);
}

/** The upload metadata as query parameters; every value is written as text, numbers in decimal. */
export function uploadQuery(metadata: UploadSourceMetadata): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(metadata)) query.append(key, String(value));
  return query.toString();
}

export const httpImportClient: ImportClient = {
  openWorkspace: (request, signal) =>
    postJson(routes.openWorkspace, request, "open_workspace", importContract.workspaceAnswer, signal),
  uploadSource: (metadata, file, signal) =>
    send(
      `${routes.sources}?${uploadQuery(metadata)}`,
      { method: "PUT", headers: { "Content-Type": "application/octet-stream", Accept: "application/json" }, body: file, signal },
      "upload_source",
      importContract.sourceAnswer,
    ),
  inspect: (request, signal) => postJson(routes.inspect, request, "inspect_csv", importContract.inspectionAnswer, signal),
  confirmMapping: (request, signal) =>
    postJson(routes.preparations, request, "confirm_mapping", importContract.interpretationAnswer, signal),
  openPopulation: (request, signal) =>
    postJson(routes.openPopulation, request, "open_population", importContract.populationAnswer, signal),
  caseEvidence: (request, signal) =>
    postJson(routes.caseEvidence, request, "case_evidence", importContract.caseEvidenceAnswer, signal),
};
