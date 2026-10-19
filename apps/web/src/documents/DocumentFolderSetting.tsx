import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DocumentFolderAnswer } from "../generated/record-documents";
import { httpDocumentClient, type DocumentClient } from "./client";

const STATES: Record<DocumentFolderAnswer["state"], string> = {
  not_set: "No document folder is set. Records with a document reference read “not available”.",
  available: "The folder is available on this computer.",
  missing: "The folder is missing on this computer. Records with a document reference read “not available”.",
  not_a_folder: "This path is not a folder. Records with a document reference read “not available”.",
};

/** The one per-workspace setting naming where the documents behind records lie; it stays with the workspace on this computer. */
export function DocumentFolderSetting({ workspaceId, client = httpDocumentClient }: { workspaceId: string; client?: DocumentClient }) {
  const [answer, setAnswer] = useState<DocumentFolderAnswer | null>(null);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<{ text: string; changed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const send = async (change: { folder: string | null } | null) => {
    const token = ++revision.current;
    setBusy(true); setProblem(null);
    const outcome = await client.folder({ schema_version: 1, message_type: "document_folder_request", request_id: crypto.randomUUID(),
      query_revision: token, workspace_id: workspaceId, change });
    if (token !== revision.current) return;
    setBusy(false);
    if (!outcome.ok) {
      setProblem({ changed: change !== null, text: outcome.problem.kind === "refusal" ? outcome.problem.refusal.message : outcome.problem.kind === "unreachable"
        ? "The local service could not be reached." : "The reply did not answer this workspace." });
      return;
    }
    setAnswer(outcome.answer);
    setText(outcome.answer.folder ?? "");
  };
  useEffect(() => { void send(null); }, [workspaceId]);
  const save = (event: FormEvent) => { event.preventDefault(); void send({ folder: text.trim() === "" ? null : text.trim() }); };
  return (
    <section className="document-folder" aria-labelledby="document-folder-title">
      <h3 id="document-folder-title">Document folder</h3>
      <p className="muted">Where the emails, notes and object cards named by a log's document reference lie. It is kept with this workspace on this computer only, never in a saved investigation or an export.</p>
      {answer && <p role="status">{answer.folder ?? "Not set"} · {STATES[answer.state]}</p>}
      <form onSubmit={save}>
        <label>
          <span className="label-text">Absolute folder on this computer</span>
          <input type="text" value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} autoComplete="off" />
        </label>
        <button type="submit" disabled={busy}>Use this document folder</button>
        {answer?.folder && <button type="button" disabled={busy} onClick={() => void send({ folder: null })}>Clear the document folder</button>}
      </form>
      {/* A change the analyst asked for that failed is an alert; a setting that could not be read is said quietly. */}
      {problem && (problem.changed ? <p role="alert">{problem.text}</p> : <p className="muted">The document folder could not be read: {problem.text}</p>)}
    </section>
  );
}
