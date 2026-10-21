import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/record-documents.schema.json";
import type {
  AttachmentOpenAnswer, AttachmentOpenRequest, DocumentFolderAnswer, DocumentFolderRequest, RecordDocumentAnswer,
  RecordDocumentRefusal, RecordDocumentRequest,
} from "../generated/record-documents";

export type DocumentProblem = { kind: "refusal"; refusal: RecordDocumentRefusal } | { kind: "unreachable" } | { kind: "unsupported_reply" };
export type DocumentOutcome<T> = { ok: true; answer: T } | { ok: false; problem: DocumentProblem };
export interface DocumentClient {
  folder(request: DocumentFolderRequest, signal?: AbortSignal): Promise<DocumentOutcome<DocumentFolderAnswer>>;
  read(request: RecordDocumentRequest, signal?: AbortSignal): Promise<DocumentOutcome<RecordDocumentAnswer>>;
  openAttachment(request: AttachmentOpenRequest, signal?: AbortSignal): Promise<DocumentOutcome<AttachmentOpenAnswer>>;
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(schema);
function check<T>(definition: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The document contract has no ${definition}.`);
  return (value: unknown): value is T => validate(value) as boolean;
}
export const documentContract = {
  folderRequest: check<DocumentFolderRequest>("DocumentFolderRequest"), folderAnswer: check<DocumentFolderAnswer>("DocumentFolderAnswer"),
  readRequest: check<RecordDocumentRequest>("RecordDocumentRequest"), readAnswer: check<RecordDocumentAnswer>("RecordDocumentAnswer"),
  openRequest: check<AttachmentOpenRequest>("AttachmentOpenRequest"), openAnswer: check<AttachmentOpenAnswer>("AttachmentOpenAnswer"),
  refusal: check<RecordDocumentRefusal>("RecordDocumentRefusal"),
};

async function post<T extends { request_id: string; query_revision: number; workspace_id: string }>(
  route: string, request: { request_id: string; query_revision: number; workspace_id: string }, answers: (value: unknown) => value is T,
  signal?: AbortSignal): Promise<DocumentOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(route, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request), signal, cache: "no-store" });
  } catch {
    return { ok: false, problem: { kind: "unreachable" } };
  }
  let value: unknown;
  try { value = await response.json(); } catch { value = undefined; }
  if (documentContract.refusal(value)) return { ok: false, problem: { kind: "refusal", refusal: value } };
  if (response.ok && answers(value) && value.request_id === request.request_id && value.query_revision === request.query_revision
      && value.workspace_id === request.workspace_id) return { ok: true, answer: value };
  return { ok: false, problem: { kind: "unsupported_reply" } };
}

/** The local service's document routes; each answers only the platform's own page. */
export const httpDocumentClient: DocumentClient = {
  folder: (request, signal) => post("/api/workspaces/document-folder", request, documentContract.folderAnswer, signal),
  read: (request, signal) => post("/api/documents/read", request, documentContract.readAnswer, signal),
  openAttachment: (request, signal) => post("/api/documents/open-attachment", request, documentContract.openAnswer, signal),
};
