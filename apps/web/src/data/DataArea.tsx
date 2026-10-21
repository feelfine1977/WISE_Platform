import { CapacityNote } from "./CapacityNote";
import { type FormEvent, useEffect, useId, useState, useSyncExternalStore } from "react";
import type { PreparationTarget } from "../imported/coordinator";
import type { DataCoordinator, DataState } from "./coordinator";
import { workspaceExamples } from "./examples";
import { ImportGuide } from "./ImportGuide";
import { ImportProblemNotice } from "./ImportProblemNotice";
import { ReadingChoices } from "./ReadingChoices";
import { byteSize } from "./wording";
import { Working } from "./Working";
import { DocumentFolderSetting } from "../documents/DocumentFolderSetting";
import { WorkspaceBackup } from "./WorkspaceBackup";

interface DataAreaProps {
  coordinator: DataCoordinator;
  onOpenIncidents: (target: PreparationTarget) => void;
}

/** Adding a source and confirming how it is read, in the workspace in use. */
export function DataArea({ coordinator, onOpenIncidents }: DataAreaProps) {
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getState);
  // Coming back from the incidents, the focus returns to the control they were opened from.
  useEffect(() => {
    const opened = coordinator.takeOpened();
    if (opened === null) return;
    const control = [...document.querySelectorAll<HTMLElement>(`[data-open-place="${opened.place}"]`)].find(
      (element) => element.dataset.openPreparation === opened.preparationId,
    );
    control?.focus();
  }, [coordinator]);
  const openFrom = (place: "report" | "table") => (target: PreparationTarget) => {
    coordinator.noteOpened(target.preparationId, place);
    onOpenIncidents(target);
  };
  return (
    <main className="data-area" aria-labelledby="data-title">
      <div className="toolbar">
        <h2 id="data-title" className="breadcrumb-current">
          Data
        </h2>
        <p className="muted">Your files stay on this computer: they go only to the local application and into its workspace folder.</p>
      </div>
      <div className="data-steps">
        <WorkspaceStep state={state} coordinator={coordinator} />
        {state.workspace.phase === "open" && (
          <SourceStep state={state} coordinator={coordinator} onOpenIncidents={openFrom("table")} />
        )}
        {state.workspace.phase === "open" && state.source.phase === "stored" && (
          <ReadingChoices state={state} coordinator={coordinator} onOpenIncidents={openFrom("report")} />
        )}
      </div>
    </main>
  );
}

/**
 * The workspace in use. The application opens a folder of its own at its start, so an open
 * workspace is one line; choosing another folder is offered behind it, and in full only while no
 * workspace is open.
 */
function WorkspaceStep({ state, coordinator }: { state: DataState; coordinator: DataCoordinator }) {
  const { workspace } = state;
  const [path, setPath] = useState(workspace.phase === "opening" || workspace.phase === "failed" ? (workspace.path ?? "") : "");
  const inputId = useId();
  function submit(event: FormEvent) {
    event.preventDefault();
    if (path.trim() !== "") coordinator.openWorkspace(path.trim());
  }
  const otherFolder = (
    <>
      <p className="muted">
        Give the full path of an empty folder for a new workspace, or of a folder you used before. It must lie outside the program.
      </p>
      <form className="inline-form" onSubmit={submit}>
        <label htmlFor={inputId} className="label-text">
          Folder path
        </label>
        <input
          id={inputId}
          type="text"
          className="path-input"
          value={path}
          spellCheck={false}
          autoComplete="off"
          placeholder="D:\Investigations\Cases"
          onChange={(event) => setPath(event.target.value)}
        />
        <button type="submit" disabled={path.trim() === ""}>
          Open workspace
        </button>
      </form>
    </>
  );
  const ownFolder = (
    <div>
      <button type="button" onClick={() => coordinator.openDefaultWorkspace()}>
        Use the application's own folder
      </button>
    </div>
  );
  if (workspace.phase === "open") {
    return (
      <section className="workspace-line" aria-labelledby="workspace-title">
        <h3 id="workspace-title" className="label-text">
          Workspace
        </h3>
        <span className="identifier">{workspace.answer.path}</span>
        <span className="muted">{workspace.own ? "The application's own folder; your sources and how they are read are kept here." : "A folder you chose."}</span>
        <span className="muted">{workspace.answer.writable ? "Writable: sources and readings are stored here, outside the program's own folders." : "Not writable."}</span>
        <details>
          <summary>Use another folder</summary>
          {otherFolder}
          {!workspace.own && ownFolder}
        </details>
        <DocumentFolderSetting key={workspace.answer.workspace_id} workspaceId={workspace.answer.workspace_id} />
        <WorkspaceBackup key={`backup-${workspace.answer.workspace_id}-${workspace.answer.path}`} workspaceId={workspace.answer.workspace_id}
          onOpen={(path) => coordinator.openWorkspace(path)} />
      </section>
    );
  }
  return (
    <section className="step" aria-labelledby="workspace-title">
      <h3 id="workspace-title" className="step-title">
        Workspace
      </h3>
      <p className="muted">
        The application keeps your sources and how they are read in a folder of its own, which it creates when it is not there yet.
      </p>
      {workspace.phase === "opening" && (
        <Working
          label={workspace.path === null ? "Opening the application's own folder…" : `Opening ${workspace.path}…`}
          startedAt={workspace.startedAt}
          onStop={() => coordinator.stopWaiting()}
        />
      )}
      {workspace.phase === "failed" && (
        <ImportProblemNotice
          title={workspace.path === null ? "The application's own folder cannot be used as a workspace" : "This folder cannot be used as a workspace"}
          problem={workspace.problem}
          onRetry={() => (workspace.path === null ? coordinator.openDefaultWorkspace() : coordinator.openWorkspace(workspace.path))}
        />
      )}
      {(workspace.phase === "none" || (workspace.phase === "failed" && workspace.path !== null)) && ownFolder}
      {workspace.phase !== "opening" && (
        <div className="other-folder">
          <h4 className="label-text">Or use another folder</h4>
          {otherFolder}
        </div>
      )}
    </section>
  );
}

function SourceStep({
  state,
  coordinator,
  onOpenIncidents,
}: {
  state: DataState;
  coordinator: DataCoordinator;
  onOpenIncidents: (target: PreparationTarget) => void;
}) {
  const { source, sources, preparations, workspace } = state;
  const inputId = useId();
  const exampleId = useId();
  const [inputKey, setInputKey] = useState(0);
  const [example, setExample] = useState(workspaceExamples[0].id);
  if (workspace.phase !== "open") return null;
  const names = new Map(sources.map((item) => [item.source_id, item.filename]));
  const current = source.phase === "stored" ? source.source.source_id : null;
  return (
    <section className="step" aria-labelledby="source-title">
      <h3 id="source-title" className="step-title">
        Source
      </h3>
      <CapacityNote />
      <div className="inline-form">
        <label htmlFor={inputId} className="label-text">
          Add an event-history CSV
        </label>
        <input
          key={inputKey}
          id={inputId}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) coordinator.addSource(file);
            setInputKey((key) => key + 1);
          }}
        />
      </div>
      <div className="inline-form">
        <label htmlFor={exampleId} className="label-text">
          Or load an example into the workspace
        </label>
        <select id={exampleId} className="example-select" value={example} onChange={(event) => setExample(event.target.value as typeof example)}>
          {workspaceExamples.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => coordinator.loadExample(workspaceExamples.find((item) => item.id === example)!)}>
          Load the example
        </button>
      </div>
      <ImportGuide onLoadExample={(chosen) => coordinator.loadExample(chosen)} />
      {source.phase === "fetching" && (
        <Working label={`Fetching ${source.filename} from the application…`} startedAt={source.startedAt} onStop={() => coordinator.stopWaiting()} />
      )}
      {source.phase === "uploading" && (
        <Working
          label={`Storing ${source.filename} (${byteSize(source.byteCount)}) in the workspace…`}
          startedAt={source.startedAt}
          onStop={() => coordinator.stopWaiting()}
        />
      )}
      {source.phase === "failed" && <ImportProblemNotice title={`${source.filename} could not be stored`} problem={source.problem} />}
      {sources.length > 0 && (
        <div className="stored-list">
          <h4 className="label-text" id="stored-sources-title">
            Sources in this workspace
          </h4>
          <table className="plain-table" aria-labelledby="stored-sources-title">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col" className="number">Size</th>
                <th scope="col">
                  <span className="visually-hidden">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sources.map((item) => (
                <tr key={item.source_id} className={item.source_id === current ? "selected" : undefined}>
                  <th scope="row" title={item.source_id}>
                    {item.filename}
                  </th>
                  <td className="number">{byteSize(item.byte_count)}</td>
                  <td>
                    {item.source_id === current ? (
                      <span className="muted">In use</span>
                    ) : (
                      <button type="button" onClick={() => coordinator.useSource(item)}>
                        Read {item.filename}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preparations.length > 0 && (
        <div className="stored-list">
          <h4 className="label-text" id="stored-preparations-title">
            Prepared readings in this workspace
          </h4>
          <table className="plain-table" aria-labelledby="stored-preparations-title">
            <thead>
              <tr>
                <th scope="col">Source file</th>
                <th scope="col">Preparation</th>
                <th scope="col">
                  <span className="visually-hidden">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {preparations.map((item) => (
                <tr key={item.preparation_id}>
                  <th scope="row">{names.get(item.source_id) ?? item.source_id}</th>
                  <td>
                    <code className="identifier-cut" title={item.preparation_id}>
                      {item.preparation_id}
                    </code>
                  </td>
                  <td>
                    <button
                      type="button"
                      data-open-preparation={item.preparation_id}
                      data-open-place="table"
                      onClick={() =>
                        onOpenIncidents({ workspaceId: workspace.answer.workspace_id, preparationId: item.preparation_id, sourceName: names.get(item.source_id) })
                      }
                    >
                      Open cases{" "}
                      <span className="visually-hidden">
                        of {names.get(item.source_id) ?? "this source"}, preparation {item.preparation_id}
                      </span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
