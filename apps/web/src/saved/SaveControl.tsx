import { type FormEvent, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { countOf } from "../data/wording";
import { type ImportedInvestigationState, type InvestigationView, type Pin, type SavedBinding, shownSelection } from "../imported/coordinator";
import { stepWording } from "../map/wording";
import { composeNotes, NOTE_FIELDS, type NoteFields, readNotes } from "./notes";
import type { SavingCoordinator } from "./coordinator";
import { SavedProblemNotice } from "./SavedInvestigations";
import { comparisonRoles } from "./wording";
import "./saved.css";

interface SaveButtonProps {
  saving: SavingCoordinator;
  open: boolean;
  onOpen: () => void;
  /** The id of the text saying why the question shown cannot be saved now; while it is given, saving waits. */
  waitingFor?: string;
}

/** "Save" in the toolbar of an investigation; it opens the save form below the toolbar. */
export function SaveButton({ saving, open, onOpen, waitingFor }: SaveButtonProps) {
  return (
    <button
      type="button"
      className="saved-toolbar-button"
      aria-expanded={open}
      aria-controls="saved-form"
      disabled={waitingFor !== undefined}
      aria-describedby={waitingFor}
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

/** The question a save form's draft belongs to: the saved investigation it revises, or the reading it would be saved from. */
function questionOf(investigation: ImportedInvestigationState): string {
  if (investigation.saved) return investigation.saved.investigationId;
  return `new:${investigation.population.phase === "ready" ? investigation.population.answer.identity.population_id : ""}`;
}

/**
 * The name and notes of the question shown, saved in its workspace, with a summary of everything the save holds. The
 * notes are a question, an observation, a counterexample, a limitation and a next check, none required. What is typed is
 * kept as an unsaved draft until it is saved, also when the form is closed or a save is refused; it is never shown as
 * saved. A question saved or reopened before is saved as a new revision of the same investigation, and the form says so.
 */
export function SaveForm({ saving, investigation, view, onClose }: SaveFormProps) {
  const state = useSyncExternalStore(saving.subscribe, saving.getState);
  const draft = saving.draft(investigation);
  const question = questionOf(investigation);
  const kept = state.form && state.form.question === question ? state.form : null;
  const [name, setName] = useState(kept?.name ?? (draft.ready ? draft.name : ""));
  const [notes, setNotes] = useState<NoteFields>(kept?.notes ?? readNotes(draft.ready ? draft.notes : ""));
  const nameId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { save } = state;
  const held = saving.heldWith(investigation);
  const savedNotes = draft.ready ? draft.notes : "";
  const unsaved = draft.ready && (composeNotes(notes) !== savedNotes.trim() || (investigation.saved !== null && name !== investigation.saved.content.name));

  useEffect(() => heading.current?.focus(), []);

  function change(nextName: string, nextNotes: NoteFields) {
    setName(nextName);
    setNotes(nextNotes);
    saving.keepForm({ question, name: nextName, notes: nextNotes });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.ready && name.trim() !== "") saving.save(name.trim(), composeNotes(notes), view);
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
      {!draft.ready && <p className="saved-muted">{draft.reason}</p>}
      {draft.ready && <SaveSummary investigation={investigation} held={held} pins={draft.pins} />}
      {draft.ready && draft.leftBehind > 0 && (
        <p className="saved-muted">
          {countOf(draft.leftBehind, "pin")} made under other steps {draft.leftBehind === 1 ? "is" : "are"} not saved with this revision; a revision saved
          before keeps {draft.leftBehind === 1 ? "it" : "them"}.
        </p>
      )}
      {kept && unsaved && save.phase !== "saved" && (
        <p className="saved-draft" role="note">
          Unsaved draft: these words were written here before and are not saved yet. Save to keep them in a revision.
        </p>
      )}
      <form className="saved-fields" onSubmit={submit}>
        <label htmlFor={nameId} className="saved-label">
          Name
        </label>
        <input id={nameId} className="saved-input" type="text" value={name} onChange={(event) => change(event.target.value, notes)} required />
        <fieldset className="saved-notes-fields">
          <legend className="saved-label">Notes, none required</legend>
          {NOTE_FIELDS.map(([field, label]) => (
            <label key={field} className="saved-note-field">
              {label}
              <textarea className="saved-note-input" value={notes[field]} rows={2} onChange={(event) => change(name, { ...notes, [field]: event.target.value })} />
            </label>
          ))}
          <label className="saved-note-field">
            Other notes
            <textarea className="saved-note-input" value={notes.other} rows={2} onChange={(event) => change(name, { ...notes, other: event.target.value })} />
          </label>
        </fieldset>
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
      {save.phase === "failed" && (
        <>
          <SavedProblemNotice title="The investigation was not saved" problem={save.problem} />
          <p className="saved-muted">What you typed is kept as an unsaved draft; it comes back when the form is opened again for this investigation.</p>
        </>
      )}
    </section>
  );
}

/** Everything a save holds, said before saving: the reading, the parent and the selection, the comparison and its parent, the outcome, the witnesses. */
function SaveSummary({ investigation, held, pins }: {
  investigation: ImportedInvestigationState; held: ReturnType<SavingCoordinator["heldWith"]>; pins: Pin[];
}) {
  const population = investigation.population.phase === "ready" ? investigation.population.answer : null;
  const shown = shownSelection(investigation.selection);
  if (!population || !shown) return null;
  const preparation = population.identity.preparation_id;
  const steps = shown.steps.length === 0 ? "no step" : shown.steps.map(stepWording).join("; and ");
  return (
    <dl className="saved-summary" aria-label="What this save holds">
      <div>
        <dt>Source and reading</dt>
        <dd>{population.source.filename}, preparation {preparation.slice(preparation.lastIndexOf(":") + 1, preparation.lastIndexOf(":") + 9)}</dd>
      </div>
      <div>
        <dt>Parent and selection</dt>
        <dd>
          {investigation.parentCaseIds === null ? `every incident, ${countOf(shown.answer.parent.case_count, "incident")}` : `${countOf(shown.answer.parent.case_count, "listed incident")}`};
          kept by {steps}: {countOf(shown.answer.kept.case_count, "incident")}
        </dd>
      </div>
      <div>
        <dt>Context</dt>
        <dd>the value at each incident's first record in the declared order (incident.context.first_record_in_declared_order.v1)</dd>
      </div>
      <div>
        <dt>Comparison</dt>
        <dd>
          {held.comparison === null ? "none" : comparisonRoles(held.comparison)}
          {held.parent && held.comparison && ` Its parent: ${countOf(held.comparison.parent_case_ids.length, "incident")} ${held.parent.label ?? (held.parent.retained_predicates.length > 0
            ? `kept by ${held.parent.retained_predicates.map(stepWording).join("; and ")}` : "")}.`}
        </dd>
      </div>
      <div>
        <dt>Outcome</dt>
        <dd>
          {held.outcome === null ? "none" : `${held.outcome.counted === "absence" ? "no recorded" : "recorded"} “${held.outcome.activity}” at the snapshot, by the first value of column ${held.outcome.context_column_index}`}
        </dd>
      </div>
      <div>
        <dt>Pinned witnesses</dt>
        <dd>{pins.length === 0 ? "none" : pins.map((pin) => `${pin.role === "supporting" ? "Supporting" : "Contrary"} · ${pin.label} (${pin.caseId})`).join("; ")}</dd>
      </div>
      <div>
        <dt>Scoring</dt>
        <dd>{held.scored ? "the score run shown is referred to" : "none: an unscored question is saved as it is"}</dd>
      </div>
    </dl>
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
      {notes !== "" && <SavedNotes notes={notes} />}
      {comparison !== null && (
        <p>
          <span className="saved-label">Comparison saved with it</span> {comparisonRoles(comparison)}
        </p>
      )}
      {bookmarks.length > 0 && (
        <p className="saved-muted">
          {countOf(bookmarks.length, "pinned witness", "pinned witnesses")} saved with it: {bookmarks.map((bookmark) => `${bookmark.label} (${bookmark.case_id})`).join(", ")}
        </p>
      )}
    </section>
  );
}

/** Saved notes as they were written: each labelled field under its label, then the rest. */
function SavedNotes({ notes }: { notes: string }) {
  const fields = readNotes(notes);
  const written = NOTE_FIELDS.filter(([field]) => fields[field] !== "");
  return (
    <dl className="saved-notes">
      {written.map(([field, label]) => (
        <div key={field}>
          <dt>{label}</dt>
          <dd>{fields[field]}</dd>
        </div>
      ))}
      {fields.other !== "" && (
        <div>
          <dt>{written.length > 0 ? "Other notes" : "Note"}</dt>
          <dd>{fields.other}</dd>
        </div>
      )}
    </dl>
  );
}

const ASPECTS: Record<string, string> = {
  source: "Source", binding: "Column roles", clock: "Clock and cutoff", parent: "Parent", selection: "Selection", comparison: "Comparison",
};

/**
 * The review of a saved question applied to another reading: what changed and what to look at again, not yet saved. The
 * revision it comes from stays as it was; saving adds the next revision.
 */
export function RefreshReview({ saving, revisionId }: { saving: SavingCoordinator; revisionId: string }) {
  const state = useSyncExternalStore(saving.subscribe, saving.getState);
  const refresh = state.refresh;
  if (!refresh || refresh.phase !== "shown" || refresh.answer.revision.saved_revision_id !== revisionId) return null;
  const items = refresh.answer.review;
  return (
    <section className="saved-review" aria-labelledby="saved-review-title">
      <h3 id="saved-review-title" className="saved-panel-title">Applied to another reading, not saved yet</h3>
      <p>
        “{refresh.answer.revision.content.name}” is shown on the chosen reading. Saving it adds a new revision; the revision it comes from stays and reopens as it
        was. Its pinned witnesses stay with it; pin and compare again here where they still matter.
      </p>
      <ul className="saved-review-list">
        {items.map((item) => (
          <li key={item.aspect} data-status={item.status}>
            <strong>{ASPECTS[item.aspect] ?? item.aspect}</strong>:{" "}
            {item.status === "unchanged" ? "unchanged" : item.status === "to_review" ? "to make again on this reading" : `changed${item.before !== null && item.after !== null && item.before.length < 80 && item.after.length < 80 ? `, ${item.before} → ${item.after}` : ""}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
