import { type FormEvent, useId, useState, useSyncExternalStore } from "react";
import type { PreparationTarget } from "../imported/coordinator";
import type { DataCoordinator, DataState } from "./coordinator";
import { workspaceExamples } from "./examples";
import { ImportProblemNotice } from "./ImportProblemNotice";
import { ReadingChoices } from "./ReadingChoices";
import { byteSize } from "./wording";
import { Working } from "./Working";

interface DataAreaProps {
  coordinator: DataCoordinator;
  onOpenIncidents: (target: PreparationTarget) => void;
  onOpenExample: () => void;
}

/** Choosing a workspace, adding a source and confirming how it is read. */
export function DataArea({ coordinator, onOpenIncidents, onOpenExample }: DataAreaProps) {
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getState);
  return (
    <main className="data-area" aria-labelledby="data-title">
      <div className="toolbar">
        <h2 id="data-title" className="breadcrumb-current">
          Data
        </h2>
        <p className="muted">
          Your files stay on this computer: they go only to the local application and into the workspace folder you choose.
        </p>
      </div>
      <div className="data-steps">
        <WorkspaceStep state={state} coordinator={coordinator} onOpenExample={onOpenExample} />
        {state.workspace.phase === "open" && (
          <SourceStep state={state} coordinator={coordinator} onOpenIncidents={onOpenIncidents} />
        )}
        {state.workspace.phase === "open" && state.source.phase === "stored" && (
          <ReadingChoices state={state} coordinator={coordinator} onOpenIncidents={onOpenIncidents} />
        )}
      </div>
    </main>
  );
}

function WorkspaceStep({ state, coordinator, onOpenExample }: { state: DataState; coordinator: DataCoordinator; onOpenExample: () => void }) {
  const { workspace } = state;
  const [path, setPath] = useState(workspace.phase === "opening" || workspace.phase === "failed" ? workspace.path : workspace.phase === "open" ? workspace.answer.path : "");
  const inputId = useId();
  function submit(event: FormEvent) {
    event.preventDefault();
    if (path.trim() !== "") coordinator.openWorkspace(path.trim());
  }
  return (
    <section className="step" aria-labelledby="workspace-title">
      <h3 id="workspace-title" className="step-title">
        Workspace
      </h3>
      <p className="muted">
        A folder outside the program where the application keeps your sources and how they are read. Choose an empty folder for a new
        workspace, or one you used before.
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
          placeholder="D:\Investigations\Incidents"
          onChange={(event) => setPath(event.target.value)}
        />
        <button type="submit" className="primary" disabled={path.trim() === ""}>
          Open workspace
        </button>
      </form>
      {workspace.phase === "opening" && (
        <Working label={`Opening ${workspace.path}…`} startedAt={workspace.startedAt} onStop={() => coordinator.stopWaiting()} />
      )}
      {workspace.phase === "failed" && (
        <ImportProblemNotice title="This folder cannot be used as a workspace" problem={workspace.problem} onRetry={() => coordinator.openWorkspace(workspace.path)} />
      )}
      {workspace.phase === "open" && (
        <p className="settled">
          <span className="label-text">Open</span> <span className="identifier">{workspace.answer.path}</span>
        </p>
      )}
      {workspace.phase !== "open" && (
        <p className="muted">
          Or{" "}
          <button type="button" className="link-button" onClick={onOpenExample}>
            explore a synthetic example
          </button>{" "}
          without a workspace.
        </p>
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
                      onClick={() => onOpenIncidents({ workspaceId: workspace.answer.workspace_id, preparationId: item.preparation_id })}
                    >
                      Open incidents{" "}
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
