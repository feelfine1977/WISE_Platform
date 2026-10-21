import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/workspace-backup.schema.json";
import type { BackUpWorkspaceAnswer, BackUpWorkspaceRequest, RestoreWorkspaceAnswer, RestoreWorkspaceRequest, WorkspaceBackupRefusal } from "../generated/workspace-backup";

export type BackupOutcome<T> = { ok: true; answer: T } | { ok: false; message: string; refusal?: WorkspaceBackupRefusal };
export interface BackupClient {
  backUp(request: BackUpWorkspaceRequest): Promise<BackupOutcome<BackUpWorkspaceAnswer>>;
  restore(request: RestoreWorkspaceRequest): Promise<BackupOutcome<RestoreWorkspaceAnswer>>;
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(schema);
function check<T>(definition: string) {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The backup contract has no ${definition}.`);
  return (value: unknown): value is T => validate(value) === true;
}
export const backupContract = {
  backUpRequest: check<BackUpWorkspaceRequest>("BackUpWorkspaceRequest"),
  backUpAnswer: check<BackUpWorkspaceAnswer>("BackUpWorkspaceAnswer"),
  restoreRequest: check<RestoreWorkspaceRequest>("RestoreWorkspaceRequest"),
  restoreAnswer: check<RestoreWorkspaceAnswer>("RestoreWorkspaceAnswer"),
  refusal: check<WorkspaceBackupRefusal>("WorkspaceBackupRefusal"),
};

async function post<T>(route: string, request: { request_id: string }, valid: (value: unknown) => value is T & { request_id: string }): Promise<BackupOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(route, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(request), cache: "no-store" });
  } catch {
    return { ok: false, message: "The local application cannot be reached. Check that it is still running, then try again." };
  }
  let value: unknown;
  try { value = await response.json(); } catch { value = undefined; }
  if (backupContract.refusal(value)) return { ok: false, message: value.message, refusal: value };
  if (response.ok && valid(value) && value.request_id === request.request_id) return { ok: true, answer: value };
  return { ok: false, message: "The reply of the local application does not answer this request." };
}

export const httpBackupClient: BackupClient = {
  backUp: (request) => post("/api/workspaces/back-up", request, backupContract.backUpAnswer),
  restore: (request) => post("/api/workspaces/restore", request, backupContract.restoreAnswer),
};
