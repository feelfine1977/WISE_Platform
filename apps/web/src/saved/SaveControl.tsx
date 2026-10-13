import { type FormEvent, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { countOf } from "../data/wording";
import type { ImportedInvestigationState, InvestigationView, SavedBinding } from "../imported/coordinator";
import type { SavingCoordinator } from "./coordinator";
import { SavedProblemNotice } from "./SavedInvestigations";
import { comparisonRoles } from "./wording";
import "./saved.css";

interface SaveButtonProps {
  saving: SavingCoordinator;
  open: boolean;
  onOpen: () => void;
}

/** "Save" in the toolbar of an investigation; it opens the save form below the toolbar. */
export function SaveButton({ saving, open, onOpen }: SaveButtonProps) {
  return (
    <button
      type="button"
      className="saved-toolbar-button"
      aria-expanded={open}
      aria-controls="saved-form"
      onClick={() => {
        saving.clearSave();
        onOpen();
      }}
    >
      Save
    </button>
  );
}

interface SaveFormProps {
  saving: SavingCoordinator;
  investigation: ImportedInvestigationState;
  view: InvestigationView;
  onClose: () => void;
}

/**
 * The name and note of the question shown, saved in its workspace. A question saved or reopened
 * before is saved as a new revision of the same investigation, and the form says so.
 */
export function SaveForm({ saving, investigation, view, onClose }: SaveFormProps) {
  const state = useSyncExternalStore(saving.subscribe, saving.getState);
  const draft = saving.draft(investigation);
  const [name, setName] = useState(draft.ready ? draft.name : "");
  const [notes, setNotes] = useState(draft.ready ? draft.notes : "");
  const nameId = useId();
  const notesId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { save } = state;

  useEffect(() => heading.current?.focus(), []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.ready && name.trim() !== "") saving.save(name.trim(), notes, view);
  }

  const savedName = investigation.saved?.content.name;
  return (
    <section id="saved-form" className="saved-form" aria-labelledby="saved-form-title">
      <h3 id="saved-form-title" className="saved-panel-title" tabIndex={-1} ref={heading}>
        {draft.ready && draft.revises ? "Save a new revision" : "Save this investigation"}
      </h3>
      {draft.ready && draft.revises && savedName !== undefined && (
        <p>
          Saving adds a new revision to “{savedName}”. The earlier revisions stay in the workspace as they were saved.
        </p>
      )}
      {draft.ready && !draft.revises && (
        <p>Saves the source, how it is read, the steps of the selection and your note in the workspace.</p>
      )}
      {!draft.ready && <p className="saved-muted">{draft.reason}</p>}
      {draft.ready && draft.leftBehind > 0 && (
        <p className="saved-muted">
          {countOf(draft.leftBehind, "bookmark")} pinned to the earlier selection {draft.leftBehind === 1 ? "is" : "are"} not carried
          into this revision; the earlier revision keeps {draft.leftBehind === 1 ? "it" : "them"}.
        </p>
      )}
      <form className="saved-fields" onSubmit={submit}>
        <label htmlFor={nameId} className="saved-label">
          Name
        </label>
        <input id={nameId} className="saved-input" type="text" value={name} onChange={(event) => setName(event.target.value)} required />
        <label htmlFor={notesId} className="saved-label">
          Note
        </label>
        <textarea id={notesId} className="saved-note-input" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        <div className="saved-actions">
          <button type="submit" className="saved-button saved-primary" disabled={!draft.ready || name.trim() === "" || save.phase === "saving"}>
            {draft.ready && draft.revises ? "Save revision" : "Save"}
          </button>
          <button type="button" className="saved-button" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
      <p role="status" className="saved-status">
        {save.phase === "saving" && `Saving “${save.name}”…`}
        {save.phase === "saved" && savedText(save.answer.created_investigation, save.answer.semantic_change, save.answer.revision.content.name)}
      </p>
      {save.phase === "failed" && <SavedProblemNotice title="The investigation was not saved" problem={save.problem} />}
    </section>
  );
}

function savedText(created: boolean, changed: boolean, name: string): string {
  if (created) return `Saved as the new investigation “${name}”.`;
  if (changed) return `Saved as a new revision of “${name}”.`;
  return `Nothing changed since the latest revision of “${name}”, so no revision was added.`;
}

/** Which saved investigation the question shown belongs to: its name, its note and its comparison. */
export function SavedLine({ binding }: { binding: SavedBinding }) {
  const { name, notes, comparison, bookmarks } = binding.content;
  return (
    <section className="saved-line" aria-label="Saved investigation">
      <p>
        <span className="saved-label">Saved investigation</span> <span className="saved-name">{name}</span>
      </p>
      {notes !== "" && <p className="saved-notes">{notes}</p>}
      {comparison !== null && (
        <p>
          <span className="saved-label">Comparison saved with it</span> {comparisonRoles(comparison)}
        </p>
      )}
      {bookmarks.length > 0 && (
        <p className="saved-muted">
          {countOf(bookmarks.length, "bookmark")}: {bookmarks.map((bookmark) => `${bookmark.label} (${bookmark.case_id})`).join(", ")}
        </p>
      )}
    </section>
  );
}
