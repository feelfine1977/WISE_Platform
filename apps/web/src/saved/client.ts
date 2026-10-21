import Ajv2020 from "ajv/dist/2020.js";
import savingSchema from "../../../../contracts/saving.schema.json";
import { uniqueItemsHold, withoutUniqueItems } from "../data/uniqueItems";
import type {
  ListSavedAnswer,
  ListSavedRequest,
  ReopenInvestigationAnswer,
  ReopenInvestigationRequest,
  RefreshInvestigationAnswer,
  RefreshInvestigationRequest,
  SaveInvestigationAnswer,
  SaveInvestigationRequest,
  SavingRefusal,
  RecoverInvestigationMetadataRequest,
  RecoverInvestigationMetadataAnswer,
  Bpic19PipelineAction,
} from "../generated/saving";

export const savingRoutes = {
  save: "/api/investigations/save",
  listSaved: "/api/investigations/list-saved",
  reopen: "/api/investigations/reopen",
  refresh: "/api/investigations/refresh",
  recoverMetadata: "/api/investigations/recover-metadata",
} as const;

/**
 * Why saving, listing or reopening produced no answer: a typed refusal from the local service, or
 * a failure this screen detected. It is always shown as a failure, never as an empty answer.
 */
export type SavingProblem =
  | { kind: "refusal"; refusal: SavingRefusal }
  | { kind: "unreachable" }
  | { kind: "http"; status: number }
  | { kind: "unsupported_reply"; detail: string };

export type SavingOutcome<T> = { ok: true; answer: T } | { ok: false; problem: SavingProblem };

export interface SavingClient {
  save(request: SaveInvestigationRequest, signal: AbortSignal): Promise<SavingOutcome<SaveInvestigationAnswer>>;
  listSaved(request: ListSavedRequest, signal: AbortSignal): Promise<SavingOutcome<ListSavedAnswer>>;
  reopen(request: ReopenInvestigationRequest, signal: AbortSignal): Promise<SavingOutcome<ReopenInvestigationAnswer>>;
  /** Applies a saved question to another reading without saving; absent where the service offers none. */
  refresh?(request: RefreshInvestigationRequest, signal: AbortSignal): Promise<SavingOutcome<RefreshInvestigationAnswer>>;
}

/** A read-only companion; it never restores an investigation or changes the save draft. */
export interface SavingMetadataClient {
  recoverMetadata(request: RecoverInvestigationMetadataRequest, signal: AbortSignal): Promise<SavingOutcome<RecoverInvestigationMetadataAnswer>>;
}

type ContractCheck<T> = (value: unknown) => value is T;

// Duplicate items are checked separately, in one pass, so that large populations stay quick.
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, formats: { "date-time": true } });
ajv.addSchema(withoutUniqueItems(savingSchema));

function validator<T>(definition: string): ContractCheck<T> {
  const validate = ajv.getSchema<T>(`${savingSchema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The saving contract has no definition ${definition}.`);
  const reference = { $ref: `#/$defs/${definition}` };
  return (value: unknown): value is T => validate(value) && uniqueItemsHold(savingSchema, reference, value);
}

export const savingContract = {
  pipelineAction: validator<Bpic19PipelineAction>("Bpic19PipelineAction"),
  saveRequest: validator<SaveInvestigationRequest>("SaveInvestigationRequest"),
  saveAnswer: validator<SaveInvestigationAnswer>("SaveInvestigationAnswer"),
  listRequest: validator<ListSavedRequest>("ListSavedRequest"),
  listAnswer: validator<ListSavedAnswer>("ListSavedAnswer"),
  reopenRequest: validator<ReopenInvestigationRequest>("ReopenInvestigationRequest"),
  reopenAnswer: validator<ReopenInvestigationAnswer>("ReopenInvestigationAnswer"),
  refreshRequest: validator<RefreshInvestigationRequest>("RefreshInvestigationRequest"),
  refreshAnswer: validator<RefreshInvestigationAnswer>("RefreshInvestigationAnswer"),
  metadataRequest: validator<RecoverInvestigationMetadataRequest>("RecoverInvestigationMetadataRequest"),
  metadataAnswer: validator<RecoverInvestigationMetadataAnswer>("RecoverInvestigationMetadataAnswer"),
  refusal: validator<SavingRefusal>("SavingRefusal"),
};

async function postJson<T>(
  route: string,
  body: unknown,
  operation: SavingRefusal["operation"],
  validateAnswer: ContractCheck<T>,
  signal: AbortSignal,
): Promise<SavingOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
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
  if (savingContract.refusal(payload) && payload.operation === operation) {
    return { ok: false, problem: { kind: "refusal", refusal: payload } };
  }
  if (!response.ok) return { ok: false, problem: { kind: "http", status: response.status } };
  if (validateAnswer(payload)) return { ok: true, answer: payload };
  return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not match the saving contract." } };
}

export const httpSavingClient: SavingClient = {
  save: (request, signal) => postJson(savingRoutes.save, request, "save_investigation", savingContract.saveAnswer, signal),
  listSaved: (request, signal) => postJson(savingRoutes.listSaved, request, "list_saved", savingContract.listAnswer, signal),
  reopen: (request, signal) => postJson(savingRoutes.reopen, request, "reopen_investigation", savingContract.reopenAnswer, signal),
  refresh: (request, signal) => postJson(savingRoutes.refresh, request, "refresh_investigation", savingContract.refreshAnswer, signal),
};

export const httpSavingMetadataClient: SavingMetadataClient = {
  recoverMetadata: (request, signal) => postJson(savingRoutes.recoverMetadata, request, "recover_investigation_metadata", savingContract.metadataAnswer, signal),
};
