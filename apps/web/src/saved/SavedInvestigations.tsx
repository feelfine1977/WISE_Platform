import { useEffect, useSyncExternalStore } from "react";
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

  function reopenOne(summary: SavedInvestigationSummary) {
    if (workspaceId === null) return;
    void saving.reopen(summary, workspaceId).then((restored) => {
      if (restored) onReopened();
    });
  }

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
                    <th scope="col">Source</th>
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
                      <th scope="row">{summary.name}</th>
                      <td>
                        {filenames.get(summary.source_id) ?? <span className="saved-identifier">{summary.source_id}</span>}
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p role="status" className="saved-status">
              {reopen.phase === "reopening" ? `Reopening “${reopen.summary.name}”: computing it again from the stored source…` : ""}
            </p>
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
