import { useEffect, useState, useSyncExternalStore } from "react";
import type { DataCoordinator } from "../data/coordinator";
import { countOf } from "../data/wording";
import type { SavedInvestigationSummary } from "../generated/saving";
import type { SavingProblem } from "./client";
import type { SavingCoordinator } from "./coordinator";
import { describeSavingProblem } from "./wording";
import { SavedMetadataRecovery } from "./SavedMetadataRecovery";
import "./saved.css";

interface SavedInvestigationsProps {
  saving: SavingCoordinator;
  data: DataCoordinator;
  /** Called once a saved investigation was restored and opened. */
  onReopened: () => void;
  onShowData: () => void;
}

/**
 * The investigations saved in the open workspace, each with its name, source and the counts it
 * was saved with, and a way to reopen it. Reopening recomputes it from its stored source; what
 * cannot be restored is shown as a refusal with what to do, never as the saved state.
 */
export function SavedInvestigations({ saving, data, onReopened, onShowData }: SavedInvestigationsProps) {
  const state = useSyncExternalStore(saving.subscribe, saving.getState);
  const dataState = useSyncExternalStore(data.subscribe, data.getState);
  const workspace = dataState.workspace.phase === "open" ? dataState.workspace.answer : null;
  const workspaceId = workspace?.workspace_id ?? null;

  useEffect(() => {
    if (workspaceId !== null) saving.list(workspaceId);
  }, [saving, workspaceId]);

  const filenames = new Map(dataState.sources.map((source) => [source.source_id, source.filename]));
  const { list, reopen } = state;

  function reopenOne(summary: SavedInvestigationSummary, revisionId = summary.latest_revision_id) {
    if (workspaceId === null) return;
    void saving.reopen({ ...summary, latest_revision_id: revisionId }, workspaceId).then((restored) => {
      if (restored) onReopened();
    });
  }

  function refreshOne(summary: SavedInvestigationSummary, preparationId: string) {
    if (workspaceId === null) return;
    void saving.refresh(summary, workspaceId, preparationId).then((refreshed) => {
      if (refreshed) onReopened();
    });
  }
  const refresh = state.refresh ?? { phase: "idle" as const };

  return (
    <main className="saved-area" aria-labelledby="saved-title">
      <div className="saved-head">
        <h2 id="saved-title" className="saved-title">
          Saved investigations
        </h2>
        <p className="saved-muted">
          A saved investigation keeps its source, how it is read, the steps of its selection and its notes. Reopening computes it
          again from the stored source and shows it only when it is the same.
        </p>
        <SavingGuide />
      </div>
      <div className="saved-body">
        {workspace === null ? (
          <section className="saved-panel" aria-label="No workspace">
            <p>Open a workspace in the Data area to see the investigations saved in it.</p>
            <button type="button" className="saved-button" onClick={onShowData}>
              Data
            </button>
          </section>
        ) : (
          <section className="saved-panel" aria-labelledby="saved-list-title">
            <h3 id="saved-list-title" className="saved-panel-title">
              In the workspace <span className="saved-path">{workspace.path}</span>
            </h3>
            {list.phase === "loading" && <p className="saved-muted">Reading the saved investigations…</p>}
            {list.phase === "failed" && (
              <SavedProblemNotice
                title="The saved investigations could not be listed"
                problem={list.problem}
                onRetry={() => saving.list(list.workspaceId)}
              />
            )}
            {list.phase === "ready" && list.answer.investigations.length === 0 && (
              <p className="saved-muted">
                No investigation is saved in this workspace yet. Open the incidents of a reading in the Data area and save them with
                “Save” in the toolbar.
              </p>
            )}
            {list.phase === "ready" && list.answer.investigations.length > 0 && (
              <table className="saved-table">
                <caption className="saved-caption">
                  The latest revision of each investigation, newest first. The counts are those at the time of saving; the source
                  is checked when you reopen.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Source and lineage</th>
                    <th scope="col">Kept when saved</th>
                    <th scope="col">Comparison</th>
                    <th scope="col">
                      <span className="saved-hidden">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.answer.investigations.map((summary) => (
                    <tr key={summary.investigation_id}>
                      <th scope="row" className="saved-row-name">{summary.name}</th>
                      <td>
                        {filenames.get(summary.source_id) ?? <span className="saved-identifier">{summary.source_id}</span>}
                        <Lineage summary={summary} folder={workspace.path} filenames={filenames} onReopen={(revisionId) => reopenOne(summary, revisionId)}
                          busy={reopen.phase === "reopening"} />
                      </td>
                      <td className="saved-figure">
                        {countOf(summary.selected_case_count, "incident")} · {countOf(summary.selected_record_count, "record")}
                      </td>
                      <td>{summary.comparison_kind === null ? "none" : summary.comparison_kind === "group" ? "two groups" : "two periods"}</td>
                      <td>
                        <button
                          type="button"
                          className="saved-button"
                          aria-label={`Reopen ${summary.name}`}
                          disabled={reopen.phase === "reopening"}
                          onClick={() => reopenOne(summary)}
                        >
                          Reopen
                        </button>
                        <RefreshChoice summary={summary} preparations={dataState.preparations.filter((item) => item.preparation_id !== summary.preparation_id)}
                          filenames={filenames} busy={refresh.phase === "refreshing"} onRefresh={(preparationId) => refreshOne(summary, preparationId)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p role="status" className="saved-status">
              {reopen.phase === "reopening" ? `Reopening “${reopen.summary.name}”: computing it again from the stored source…` : ""}
              {refresh.phase === "refreshing" ? `Applying “${refresh.summary.name}” to the other reading…` : ""}
            </p>
            {refresh.phase === "failed" && (
              <SavedProblemNotice title={`“${refresh.summary.name}” could not be applied to that reading`} problem={refresh.problem} />
            )}
            {reopen.phase === "failed" && (
              <><SavedProblemNotice title={`“${reopen.summary.name}” could not be reopened`} problem={reopen.problem} onRetry={() => reopenOne(reopen.summary)} />
              {workspaceId && reopen.problem.kind === "refusal" && ["artifact_unavailable", "checksum_mismatch"].includes(reopen.problem.refusal.code) &&
                <SavedMetadataRecovery key={`${workspaceId}-${reopen.summary.latest_revision_id}`} workspaceId={workspaceId} savedRevisionId={reopen.summary.latest_revision_id} />}</>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

interface SavedProblemNoticeProps {
  title: string;
  problem: SavingProblem;
  onRetry?: () => void;
}

/** A refused or failed request of saving: what happened, what to do, and a retry where it helps. */
export function SavedProblemNotice({ title, problem, onRetry }: SavedProblemNoticeProps) {
  const text = describeSavingProblem(problem);
  const retryable = problem.kind !== "refusal" || problem.refusal.retryable;
  return (
    <div className="saved-problem" role="alert">
      <p className="saved-problem-title">{title}</p>
      <p>{text.message}</p>
      <p>
        <span className="saved-label">What to do</span> {text.remedy}
      </p>
      {onRetry && retryable && (
        <button type="button" className="saved-button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

const shortId = (id: string) => id.slice(id.lastIndexOf(":") + 1, id.lastIndexOf(":") + 9);
const savedTime = (utc: string) => utc.replace("T", " ").replace(/(\.\d+)?Z$/, " UTC");

/**
 * Where a saved investigation comes from and where it is kept: its source cutoff, its revisions newest first with the
 * reading each was saved on, and its folder. What is listed is read from the saved files and not yet checked against the
 * stored source; reopening checks it. An earlier revision can be reopened as it was, and says that a newer one exists.
 */
function Lineage({ summary, folder, filenames, onReopen, busy }: {
  summary: SavedInvestigationSummary; folder: string; filenames: Map<string, string>; onReopen: (revisionId: string) => void; busy: boolean;
}) {
  const revisions = summary.revisions ?? [];
  return (
    <div className="saved-lineage">
      <p className="saved-muted">
        Preparation {shortId(summary.preparation_id)}
        {summary.snapshot_cutoff ? ` · source cutoff ${summary.snapshot_cutoff.replace("T", " ").replace("Z", " UTC")}` : ""}
        {summary.saved_utc ? ` · saved ${savedTime(summary.saved_utc)}` : ""} · kept in {folder}
      </p>
      <p className="saved-muted">Listed as saved, not checked yet: the source and the identities are checked when it is reopened.</p>
      {revisions.length > 1 && (
        <details>
          <summary>{countOf(revisions.length, "revision")}; earlier ones stay as they were saved</summary>
          <ol className="saved-revisions">
            {revisions.map((revision, place) => (
              <li key={revision.saved_revision_id}>
                Revision {revisions.length - place}, saved {savedTime(revision.saved_utc)} on {filenames.get(revision.source_id) ?? "a source"}, preparation{" "}
                {shortId(revision.preparation_id)}
                {place === 0 ? " (latest)" : " (earlier: a newer revision exists)"}
                {place > 0 && (
                  <>
                    {" "}
                    <button type="button" className="link-button" disabled={busy} onClick={() => onReopen(revision.saved_revision_id)}
                      aria-label={`Reopen revision ${revisions.length - place} of ${summary.name}`}>
                      Reopen this revision
                    </button>
                  </>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/**
 * Applies a saved question to another reading of the workspace, for example of a refreshed source: it is shown with what
 * changed and is not saved until it is saved, as a new revision; the revision it comes from stays as it was.
 */
function RefreshChoice({ summary, preparations, filenames, busy, onRefresh }: {
  summary: SavedInvestigationSummary; preparations: { preparation_id: string; source_id: string }[]; filenames: Map<string, string>; busy: boolean;
  onRefresh: (preparationId: string) => void;
}) {
  const [chosen, setChosen] = useState("");
  if (preparations.length === 0) return null;
  return (
    <details className="saved-refresh">
      <summary>Apply to another reading</summary>
      <label>
        Reading
        <select value={chosen} onChange={(event) => setChosen(event.target.value)} aria-label={`Reading to apply ${summary.name} to`}>
          <option value="">Choose a reading</option>
          {preparations.map((item) => (
            <option key={item.preparation_id} value={item.preparation_id}>
              {filenames.get(item.source_id) ?? "a source"}, preparation {shortId(item.preparation_id)}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="saved-button" disabled={chosen === "" || busy} onClick={() => onRefresh(chosen)}>
        Apply, without saving
      </button>
    </details>
  );
}

/** What saving and reopening verify, and where their recovery ends. */
export function SavingGuide() {
  return (
    <details className="saved-guide">
      <summary>How saving works</summary>
      <ul>
        <li>A save is one immutable revision in the workspace folder: the source by its fingerprint, how it is read, the parent, the steps, the comparison
          with its frozen parent, the outcome, the pinned witnesses and the notes. A score run is referred to only where one is shown.</li>
        <li>Each save names the revision it replaces. If someone saved again since you opened it, nothing is saved and what you typed is kept as an
          unsaved draft; reopen the latest revision and save again.</li>
        <li>Reopening computes everything again from the stored source and shows the question only when its identities and counts are the ones saved.
          A changed, missing or damaged source or revision is refused with what to do; it is never read in another way.</li>
        <li>A refreshed source is a new reading. Applying a saved question to it shows what changed, and saving makes a new revision; the earlier
          revision stays and reopens as it was. Pinned witnesses and the comparison stay with the earlier revision until you pin and compare again.</li>
        <li>Limits: the list shows what the files say until a revision is reopened; the sort of a table and hand-moved activities are not saved; a
          workspace is recovered only by copying its stopped folder.</li>
      </ul>
    </details>
  );
}
