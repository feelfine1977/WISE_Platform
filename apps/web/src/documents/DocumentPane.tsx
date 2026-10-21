import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AnswerIdentity, ImportedSourceRecord } from "../generated/imports";
import type { RecordDocumentAnswer } from "../generated/record-documents";
import { httpDocumentClient, type DocumentClient, type DocumentProblem } from "./client";
import "./documents.css";

/** The record's document reference, as its mapped column names it; empty when the record names none. */
export function referenceOf(record: ImportedSourceRecord, column: number): string {
  return (record.original_cells[column] ?? "").trim();
}

const REASONS: Record<string, string> = {
  no_reference: "This record names no document.",
  folder_not_set: "No document folder is set for this workspace. Name it in the Data view.",
  folder_missing: "The document folder is missing on this computer.",
  not_a_valid_reference: "Not a valid document reference.",
  outside_folder: "The document lies outside the document folder and is not read.",
  file_missing: "The document file is missing from the document folder.",
  unreadable: "The document file cannot be read.",
  invalid_json: "The document file is not valid JSON.",
  unknown_format_version: "The document has an unknown format version.",
  invalid_document: "The document does not follow the record document format.",
};
const OPEN_REASONS: Record<string, string> = {
  document_unavailable: "the document is not available",
  no_such_attachment: "the document lists no such attachment",
  not_an_allowed_type: "its type is not on the list of document types the platform opens",
  type_mismatch: "its content does not match its declared type and extension",
  invalid_path: "its path is not a plain path inside the document folder",
  outside_folder: "it lies outside the document folder",
  file_missing: "the file is missing",
  unsupported_system: "this computer's system cannot be asked to open it",
  open_failed: "the computer could not open it",
};

function unavailableText(answer: RecordDocumentAnswer): string {
  if (answer.reason === "too_large") {
    return `Too large to show: ${(answer.size_bytes ?? 0).toLocaleString("en")} bytes; the stated limit is ${answer.max_document_bytes.toLocaleString("en")} bytes. Nothing was cut.`;
  }
  return REASONS[answer.reason ?? ""] ?? "Not available.";
}

function problemText(problem: DocumentProblem): string {
  if (problem.kind === "refusal") return `${problem.refusal.message} (${problem.refusal.code})`;
  if (problem.kind === "unreachable") return "The local service could not be reached. Try again.";
  return "The reply did not answer this record's document.";
}

interface DocumentPaneProps {
  workspaceId: string;
  identity: AnswerIdentity;
  caseId: string;
  records: readonly ImportedSourceRecord[];
  documentColumn: number;
  /** The place, in the incident's declared order, of the record whose document is shown. */
  place: number;
  onPlace: (place: number) => void;
  onClose: () => void;
  client?: DocumentClient;
}

type Shown = { phase: "loading" } | { phase: "failed"; text: string } | { phase: "answered"; answer: RecordDocumentAnswer };

/** One record's document beside the incident's timeline, read as plain text from the local document folder. */
export function DocumentPane({ workspaceId, identity, caseId, records, documentColumn, place, onPlace, onClose, client = httpDocumentClient }: DocumentPaneProps) {
  const [shown, setShown] = useState<Shown>({ phase: "loading" });
  const [opening, setOpening] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const revision = useRef(0);
  const record = records[place];
  const withDocument = useMemo(() => records.map((item) => referenceOf(item, documentColumn) !== ""), [records, documentColumn]);
  const step = (direction: -1 | 1) => {
    let target = place + direction, skipped = 0;
    while (target >= 0 && target < records.length && !withDocument[target]) { target += direction; skipped += 1; }
    return target >= 0 && target < records.length ? { target, skipped } : null;
  };
  const previous = step(-1), next = step(1);
  const [skippedNote, setSkippedNote] = useState("");

  useEffect(() => {
    const abort = new AbortController(), token = ++revision.current;
    setShown({ phase: "loading" }); setOpening(null);
    void client.read({ schema_version: 1, message_type: "record_document_request", request_id: crypto.randomUUID(), query_revision: token,
      workspace_id: workspaceId, identity, case_id: caseId, row_id: record.row_id }, abort.signal).then((outcome) => {
      if (abort.signal.aborted || token !== revision.current) return;
      setShown(outcome.ok ? { phase: "answered", answer: outcome.answer } : { phase: "failed", text: problemText(outcome.problem) });
    });
    return () => abort.abort();
  }, [client, workspaceId, identity, caseId, record.row_id, attempt]);

  useEffect(() => { heading.current?.focus(); }, [place]);

  const go = (target: { target: number; skipped: number } | null) => {
    if (!target) return;
    setSkippedNote(target.skipped > 0 ? `${target.skipped} ${target.skipped === 1 ? "record" : "records"} without a document skipped.` : "");
    onPlace(target.target);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
  };
  const open = async (index: number, name: string) => {
    setOpening(`Asking this computer to open ${name}…`);
    const outcome = await client.openAttachment({ schema_version: 1, message_type: "attachment_open_request", request_id: crypto.randomUUID(),
      query_revision: revision.current, workspace_id: workspaceId, identity, case_id: caseId, row_id: record.row_id, attachment_index: index });
    if (!outcome.ok) { setOpening(`${name} was not opened: ${problemText(outcome.problem)}`); return; }
    setOpening(outcome.answer.opened ? `${name} was handed to this computer's default program.` : `${name} was not opened: ${OPEN_REASONS[outcome.answer.reason ?? ""] ?? "it was refused"}.`);
  };
  const answer = shown.phase === "answered" ? shown.answer : null;
  const document = answer?.document ?? null;
  const changes = document ? [...document.changes].sort((left, right) => left.time.localeCompare(right.time)) : [];
  return (
    <section className="document-pane" aria-labelledby="document-pane-title" onKeyDown={onKeyDown}>
      <div className="document-head">
        <h3 id="document-pane-title" tabIndex={-1} ref={heading}>
          Document of record {place + 1} of {records.length}
        </h3>
        <div className="document-steps">
          <button type="button" disabled={!previous} onClick={() => go(previous)}>Previous document</button>
          <button type="button" disabled={!next} onClick={() => go(next)}>Next document</button>
          <button type="button" onClick={onClose}>Close document</button>
        </div>
      </div>
      <p className="document-announce" role="status" aria-live="polite">
        {record.activity ?? "No activity label"} · source position {record.source_position}. {skippedNote}
      </p>
      {shown.phase === "loading" && <p className="working-text">Reading the document from the document folder…</p>}
      {shown.phase === "failed" && <p role="alert">{shown.text} <button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></p>}
      {answer && answer.state === "unavailable" && <p className="document-unavailable">Not available: {unavailableText(answer)}</p>}
      {document && (
        <article className="document-body" aria-label={`${document.kind}: ${document.title}`}>
          {document.masked && <p className="document-masked" role="note">Masked text · this is not the original wording and must not be quoted as such.</p>}
          {document.cut && <p className="document-cut" role="note">Shortened by its source · the work side cut this document.</p>}
          <p className="document-kind">{document.kind}</p>
          <h4 className="document-title">{document.title}</h4>
          {document.fields.length > 0 && (
            <dl className="pairs document-fields">
              {document.fields.map((field, index) => (
                <div key={index}><dt>{field.label}</dt><dd>{field.value}</dd></div>
              ))}
            </dl>
          )}
          {document.text.split(/\n\s*\n/).filter((paragraph) => paragraph.trim() !== "").map((paragraph, index) => (
            <p key={index} className="document-paragraph">{paragraph}</p>
          ))}
          {changes.length > 0 && (
            <table className="plain-table document-changes">
              <caption>Field changes in time order</caption>
              <thead><tr><th>Time</th><th>Field</th><th>Before</th><th>After</th></tr></thead>
              <tbody>{changes.map((change, index) => (
                <tr key={index}><td>{change.time}</td><td>{change.field}</td><td>{change.old ?? "empty"}</td><td>{change.new ?? "empty"}</td></tr>
              ))}</tbody>
            </table>
          )}
          {document.attachments.length > 0 && (
            <table className="plain-table document-attachments">
              <caption>Attachments</caption>
              <thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Open</th></tr></thead>
              <tbody>{document.attachments.map((item, index) => (
                <tr key={index}>
                  <td>{item.name}{document.masked && <span className="document-masked-tag"> · Masked text</span>}</td>
                  <td>{item.type}</td>
                  <td>{item.size.toLocaleString("en")} bytes</td>
                  <td>{answer?.openable_attachments[index]
                    ? <button type="button" onClick={() => void open(index, item.name)}>Open {item.name}</button>
                    : <span className="muted">not opened · not a document type the platform opens</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {opening && <p role="status">{opening}</p>}
        </article>
      )}
    </section>
  );
}
