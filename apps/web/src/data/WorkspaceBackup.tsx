import { type FormEvent, useRef, useState } from "react";
import { countOf } from "./wording";
import type { BackUpWorkspaceAnswer, RestoreWorkspaceAnswer } from "../generated/workspace-backup";
import { type BackupClient, httpBackupClient } from "./backupClient";

type Step<T> = { phase: "idle" } | { phase: "working" } | { phase: "done"; answer: T } | { phase: "failed"; message: string };

const inventory = (counts: BackUpWorkspaceAnswer["counts"]) =>
  [countOf(counts.sources, "source"), countOf(counts.preparations, "reading"), countOf(counts.investigations, "saved investigation"), countOf(counts.revisions, "revision"),
    countOf(counts.score_runs, "score run")].join(", ");

/**
 * A backup of the workspace in use, as the application wrote it, into a new or empty folder, and the restore of a
 * finished backup into another one, checked before it is used. A restored workspace keeps its identity and is opened on
 * request. What is not backed up (a setting naming a folder of this computer) is said.
 */
export function WorkspaceBackup({ workspaceId, onOpen, client = httpBackupClient }: { workspaceId: string; onOpen: (path: string) => void; client?: BackupClient }) {
  const [destination, setDestination] = useState("");
  const [backupPath, setBackupPath] = useState("");
  const [restorePath, setRestorePath] = useState("");
  const [backUp, setBackUp] = useState<Step<BackUpWorkspaceAnswer>>({ phase: "idle" });
  // What a backup into the folder named would hold, said before anything is written; a backup is made only into the folder previewed.
  const [previewed, setPreviewed] = useState<Step<BackUpWorkspaceAnswer>>({ phase: "idle" });
  const previewedHere = previewed.phase === "done" && previewed.answer.path === destination.trim();
  const [restored, setRestored] = useState<Step<RestoreWorkspaceAnswer>>({ phase: "idle" });
  const sequence = useRef(0);
  const request = (kind: string) => {
    sequence.current += 1;
    return { schema_version: 1 as const, request_id: `${kind}-${sequence.current}`, query_revision: sequence.current };
  };
  async function preview() {
    setPreviewed({ phase: "working" });
    const outcome = await client.backUp({ ...request("preview"), message_type: "back_up_workspace_request", workspace_id: workspaceId, destination: destination.trim(), preview_only: true });
    setPreviewed(outcome.ok ? { phase: "done", answer: outcome.answer } : { phase: "failed", message: outcome.message });
  }
  async function submitBackUp(event: FormEvent) {
    event.preventDefault();
    if (!previewedHere) return;
    setBackUp({ phase: "working" });
    const outcome = await client.backUp({ ...request("backup"), message_type: "back_up_workspace_request", workspace_id: workspaceId, destination: destination.trim() });
    setBackUp(outcome.ok ? { phase: "done", answer: outcome.answer } : { phase: "failed", message: outcome.message });
  }
  async function submitRestore(event: FormEvent) {
    event.preventDefault();
    setRestored({ phase: "working" });
    const outcome = await client.restore({ ...request("restore"), message_type: "restore_workspace_request", backup_path: backupPath.trim(), destination: restorePath.trim() });
    setRestored(outcome.ok ? { phase: "done", answer: outcome.answer } : { phase: "failed", message: outcome.message });
  }
  return (
    <details className="workspace-backup">
      <summary>Back up or restore</summary>
      <p className="muted">
        A backup copies what the application wrote in this workspace: its sources, readings, saved investigations with every revision, and score runs, each
        checked by its fingerprint. It is made into a new or empty folder and is complete only when it says so. Stages kept in this browser are not part of it.
      </p>
      <form onSubmit={(event) => void submitBackUp(event)}>
        <label>
          Backup folder, a new or empty folder by its whole path
          <input type="text" value={destination} onChange={(event) => setDestination(event.target.value)} />
        </label>
        <button type="button" disabled={destination.trim() === "" || previewed.phase === "working"} onClick={() => void preview()}>Preview the backup</button>{" "}
        <button type="submit" disabled={!previewedHere || backUp.phase === "working"}>Back up this workspace</button>
      </form>
      <p role="status" className="muted backup-preview">
        {previewed.phase === "working" && "Listing what the backup would hold…"}
        {previewed.phase === "done" && previewedHere &&
          `A backup into ${previewed.answer.path}, a folder of this computer, would hold ${countOf(previewed.answer.file_count, "file")} ` +
            `(${(previewed.answer.byte_count / 1024).toLocaleString("en", { maximumFractionDigits: 1 })} KiB): ${inventory(previewed.answer.counts)}. ` +
            "It is written there and nowhere else; nothing is sent over a network." +
            (previewed.answer.omitted.length > 0 ? " Not in it: the folder of record documents, a folder of this computer." : "")}
        {previewed.phase === "done" && !previewedHere && "The folder was changed after the preview: preview the backup again."}
      </p>
      {previewed.phase === "failed" && <p role="alert">No backup can be made there. {previewed.message}</p>}
      <p role="status" className="muted">
        {backUp.phase === "working" && "Backing up…"}
        {backUp.phase === "done" &&
          `Backed up into ${backUp.answer.path}: ${countOf(backUp.answer.file_count, "file")}, ${inventory(backUp.answer.counts)}.` +
            (backUp.answer.omitted.length > 0 ? ` Not backed up: the folder of record documents, a folder of this computer; set it again after restoring.` : "")}
      </p>
      {backUp.phase === "failed" && <p role="alert">No backup was made. {backUp.message}</p>}
      <form onSubmit={(event) => void submitRestore(event)}>
        <label>
          Backup to restore, by its whole path
          <input type="text" value={backupPath} onChange={(event) => setBackupPath(event.target.value)} />
        </label>
        <label>
          Restore into a new or empty folder, by its whole path
          <input type="text" value={restorePath} onChange={(event) => setRestorePath(event.target.value)} />
        </label>
        <button type="submit" disabled={backupPath.trim() === "" || restorePath.trim() === "" || restored.phase === "working"}>Restore the backup</button>
      </form>
      <p role="status" className="muted">
        {restored.phase === "working" && "Checking every file of the backup and restoring it…"}
        {restored.phase === "done" &&
          `Restored and checked into ${restored.answer.path}: ${inventory(restored.answer.counts)}. It is the same workspace, ${restored.answer.workspace_id}; opening it takes the place of this one.`}
      </p>
      {restored.phase === "done" && restored.answer.warnings.map((warning) => <p key={warning} className="muted">{warning}</p>)}
      {restored.phase === "done" && (
        <button type="button" onClick={() => onOpen(restored.answer.path)}>Open the restored workspace</button>
      )}
      {restored.phase === "failed" && <p role="alert">Nothing was restored. {restored.message}</p>}
    </details>
  );
}
