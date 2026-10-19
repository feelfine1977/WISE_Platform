import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { importContract } from "../data/client";
import { confirmationOf, emptyDraft } from "../data/interpretation";
import type { AnswerIdentity, ImportedCaseEvidenceAnswer } from "../generated/imports";
import type { AttachmentOpenRequest, RecordDocumentAnswer, RecordDocumentRequest } from "../generated/record-documents";
import { ImportedInspector } from "../imported/ImportedInspector";
import { documentContract, type DocumentClient } from "./client";
import { DocumentFolderSetting } from "./DocumentFolderSetting";
import { DocumentPane } from "./DocumentPane";
import fixture from "./document-fixture.json";

// The service's own answers for the invented log and documents of apps/api/tests/record_document_fixture.py.
const identity = fixture.identity as AnswerIdentity;
const workspaceId = fixture.workspace_id;
function incident(caseId: "I-1" | "I-2" | "I-3"): ImportedCaseEvidenceAnswer {
  const value: unknown = structuredClone(fixture.cases[caseId]);
  if (!importContract.caseEvidenceAnswer(value)) throw new Error("The case evidence fixture must satisfy the import contract.");
  return value;
}
function answerFor(request: RecordDocumentRequest): RecordDocumentAnswer {
  const value: unknown = { ...structuredClone((fixture.documents as Record<string, unknown>)[request.row_id] as object), request_id: request.request_id, query_revision: request.query_revision };
  if (!documentContract.readAnswer(value)) throw new Error("The document fixture must satisfy the record document contract.");
  return value;
}
function client(): DocumentClient & { opened: AttachmentOpenRequest[] } {
  const opened: AttachmentOpenRequest[] = [];
  return {
    opened,
    folder: vi.fn(),
    read: vi.fn(async (request: RecordDocumentRequest) => ({ ok: true as const, answer: answerFor(request) })),
    openAttachment: vi.fn(async (request: AttachmentOpenRequest) => {
      opened.push(request);
      return { ok: true as const, answer: { schema_version: 1 as const, message_type: "attachment_open_answer" as const, request_id: request.request_id,
        query_revision: request.query_revision, workspace_id: request.workspace_id, opened: true, reason: null } };
    }),
  };
}
function pane(caseId: "I-1" | "I-2" | "I-3", place: number, documents = client()) {
  const answer = incident(caseId), onPlace = vi.fn(), onClose = vi.fn();
  const view = render(<DocumentPane workspaceId={workspaceId} identity={identity} caseId={caseId} records={answer.records} documentColumn={3}
    place={place} onPlace={onPlace} onClose={onClose} client={documents} />);
  return { answer, onPlace, onClose, documents, view, user: userEvent.setup() };
}

describe("#132 the document reference at import", () => {
  const ids = { workspaceId: "workspace.v1:invented-0001", sourceId: `source.v1:sha256:${"a".repeat(64)}` };
  const chosen = { ...emptyDraft, encoding: "utf-8" as const, delimiter: "," as const, caseColumn: 0, activityColumn: 1, timestampColumn: 2,
    contextColumns: [3], timeFormat: "iso8601" as const, zone: "from_values" as const, cutoff: "2027-01-01T00:00" };
  it("is a declared role only when chosen among the context columns", () => {
    expect(confirmationOf({ ...chosen, documentColumn: 3 }, ids, { requestId: "r", revision: 1 }, false)?.mapping.document_reference_column).toBe(3);
    expect(confirmationOf({ ...chosen, documentColumn: null }, ids, { requestId: "r", revision: 1 }, false)?.mapping).not.toHaveProperty("document_reference_column");
    expect(confirmationOf({ ...chosen, contextColumns: [], documentColumn: 3 }, ids, { requestId: "r", revision: 1 }, false)?.mapping).not.toHaveProperty("document_reference_column");
  });
});

describe("#132 the reading pane", () => {
  it("shows the masked email as plain text with its fields, paragraphs and attachments", async () => {
    const { documents, user } = pane("I-1", 0);
    await screen.findByText("Invented question about an invented invoice");
    expect(screen.getByRole("note").textContent).toMatch(/^Masked text/);
    expect(screen.getByText("Invented Sender")).toBeTruthy();
    expect(screen.getByText("Invented body text for the record document fixture")).toBeTruthy();
    expect(screen.getByText("Second paragraph of the invented email.")).toBeTruthy();
    const attachments = within(screen.getByRole("table", { name: "Attachments" })).getAllByRole("row").slice(1);
    expect(attachments).toHaveLength(12);
    // Every attachment carries the masked marker; only the stated document types can be opened, and only by a deliberate click.
    expect(attachments.every((row) => row.textContent?.includes("Masked text"))).toBe(true);
    expect(screen.getAllByRole("button", { name: /^Open Invented/ }).map((button) => button.textContent)).toEqual([
      "Open Invented letter.pdf", "Open Invented photo.png", "Open Invented contract.docx", "Open Invented fake.pdf", "Open Invented parent.txt", "Open Invented gone.pdf", "Open Invented linked.txt", "Open Invented junction.txt"]);
    expect(within(attachments[3]).getByText(/not opened/)).toBeTruthy();
    expect(documents.opened).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Open Invented letter.pdf" }));
    await screen.findByText("Invented letter.pdf was handed to this computer's default program.");
    expect(documents.opened.map((request) => [request.case_id, request.attachment_index])).toEqual([["I-1", 0]]);
  });

  it("steps through the incident's documents, counting the records without one", async () => {
    const { onPlace, user } = pane("I-1", 1);
    await screen.findByText("Invented internal note");
    await user.click(screen.getByRole("button", { name: "Next document" }));
    // The call between the note and the status change has no document: it is skipped and counted.
    expect(onPlace).toHaveBeenLastCalledWith(3);
    await user.click(screen.getByRole("button", { name: "Previous document" }));
    expect(onPlace).toHaveBeenLastCalledWith(0);
  });

  it("says why a document is not available, in words, and keeps the size of one too large", async () => {
    const answer = incident("I-3");
    const place = (activity: string) => answer.records.findIndex((record) => record.activity === activity);
    const expectations: [string, RegExp][] = [
      ["Path reference", /Not a valid document reference\./], ["Device reference", /Not a valid document reference\./],
      ["Missing file", /missing from the document folder/], ["Invalid json", /not valid JSON/], ["Old version", /unknown format version/],
      ["Escaping link", /outside the document folder/], ["Unreadable file", /cannot be read/], ["Too large", /Too large to show: 1,048,58\d bytes; the stated limit is 1,048,576 bytes\. Nothing was cut\./]];
    for (const [activity, words] of expectations) {
      const { view } = pane("I-3", place(activity));
      expect((await screen.findByText(/^Not available:/)).textContent).toMatch(words);
      view.unmount();
    }
    pane("I-3", place("Cut document"));
    expect((await screen.findByText(/Shortened by its source/)).textContent).toBeTruthy();
  });

  it("never renders markup, a script, a link or a remote image from a document", async () => {
    const answer = incident("I-3");
    const { view } = pane("I-3", answer.records.findIndex((record) => record.activity === "Markup document"));
    await screen.findByText("<i>Invented markup title</i>");
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeTruthy();
    expect(view.container.querySelector("img, script, a, b, i, u, iframe")).toBeNull();
  });

  it("shows an object's field changes in time order, and closes on Escape", async () => {
    const { onClose, user } = pane("I-2", 1);
    const changes = await screen.findByRole("table", { name: "Field changes in time order" });
    expect(within(changes).getAllByRole("row").slice(1).map((row) => row.firstElementChild?.nextElementSibling?.textContent)).toEqual(["Owner", "Credit limit"]);
    expect(document.activeElement?.id).toBe("document-pane-title");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("#132 opening documents from an incident", () => {
  function inspector() {
    const answer = incident("I-1"), documents = client();
    render(<ImportedInspector inspected={{ phase: "ready", caseId: answer.case_id, answer }} summary={undefined} layout="side" onLayout={() => undefined}
      onReturn={() => undefined} onRetry={() => undefined} headingRef={createRef<HTMLHeadingElement>()}
      documents={{ workspaceId, identity, column: 3, client: documents }} />);
    return { answer, documents, user: userEvent.setup() };
  }

  it("offers the document of each record that names one, beside the timeline, and returns to the record when closed", async () => {
    const { user } = inspector();
    const entries = within(screen.getByRole("list", { name: "Records of incident I-1 in the declared order" })).getAllByRole("listitem");
    expect(entries.map((entry) => within(entry).queryByRole("button", { name: "Open document" }) !== null)).toEqual([true, true, false, true]);
    await user.click(within(entries[0]).getByRole("button", { name: "Open document" }));
    await screen.findByText("Invented question about an invented invoice");
    // The timeline stays visible beside the pane.
    expect(screen.getByRole("region", { name: "Elapsed time of incident I-1" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close document" }));
    await waitFor(() => expect(document.activeElement).toBe(entries[0]));
  });

  it("opens a mark's document from the timeline by keyboard", async () => {
    const { user } = inspector();
    const strip = screen.getByRole("group", { name: /Recorded times of incident I-1/ });
    const marks = within(strip).getAllByRole("button");
    expect(marks[0].getAttribute("aria-label")).toMatch(/a document is available, press D to open it$/);
    expect(marks[2].getAttribute("aria-label")).not.toMatch(/document/);
    marks[0].focus();
    await user.keyboard("d");
    await screen.findByText("Invented question about an invented invoice");
  });
});

describe("#132 the document folder setting", () => {
  it("shows the folder and its state, and a refused change as an alert", async () => {
    const replies = [
      { state: "not_set", folder: null },
      { refused: true },
      { state: "available", folder: "/Invented/documents" },
    ];
    const folder = vi.fn(async (request: Parameters<DocumentClient["folder"]>[0]) => {
      const reply = replies.shift()!;
      if ("refused" in reply) return { ok: false as const, problem: { kind: "refusal" as const, refusal: { schema_version: 1 as const, message_type: "record_document_refusal" as const,
        request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id, code: "invalid_folder" as const,
        message: "The document folder must be an absolute folder on this computer.", field: "change.folder", retryable: false } } };
      return { ok: true as const, answer: { schema_version: 1 as const, message_type: "document_folder_answer" as const, request_id: request.request_id,
        query_revision: request.query_revision, workspace_id: request.workspace_id, ...reply } as never };
    });
    render(<DocumentFolderSetting workspaceId={workspaceId} client={{ folder, read: vi.fn(), openAttachment: vi.fn() }} />);
    const user = userEvent.setup();
    expect((await screen.findByRole("status")).textContent).toMatch(/^Not set · No document folder is set/);
    await user.type(screen.getByRole("textbox", { name: "Absolute folder on this computer" }), "relative");
    await user.click(screen.getByRole("button", { name: "Use this document folder" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The document folder must be an absolute folder on this computer.");
    await user.clear(screen.getByRole("textbox", { name: "Absolute folder on this computer" }));
    await user.type(screen.getByRole("textbox", { name: "Absolute folder on this computer" }), "/Invented/documents");
    await user.click(screen.getByRole("button", { name: "Use this document folder" }));
    await screen.findByText("/Invented/documents · The folder is available on this computer.");
    expect(folder.mock.calls.map(([request]) => request.change)).toEqual([null, { folder: "relative" }, { folder: "/Invented/documents" }]);
  });
});
