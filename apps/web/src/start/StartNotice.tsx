import { useSyncExternalStore } from "react";
import { ImportProblemNotice } from "../data/ImportProblemNotice";
import type { FirstOpen } from "./firstOpen";

interface StartNoticeProps {
  start: FirstOpen;
  onShowData: () => void;
}

/**
 * What stands in the place of an investigation while none is open: what the start of the
 * application is doing, or what stopped it and how to go on.
 */
export function StartNotice({ start, onShowData }: StartNoticeProps) {
  const state = useSyncExternalStore(start.subscribe, start.getState);
  return (
    <main className="data-area" aria-labelledby="start-title">
      <div className="toolbar">
        <h2 id="start-title" className="breadcrumb-current">
          Investigations
        </h2>
      </div>
      <div className="data-steps">
        <section className="step" aria-label="Opening an investigation">
          {(state.phase === "idle" || state.phase === "workspace") && (
            <p role="status" className="working-text">
              Opening the application's workspace…
            </p>
          )}
          {state.phase === "example" && (
            <p role="status" className="working-text">
              Reading the built-in sample into the workspace. Its process map opens as soon as it is read…
            </p>
          )}
          {state.phase === "failed" && state.step === "workspace" && state.problem && (
            <>
              <ImportProblemNotice title="The application could not open its workspace" problem={state.problem} onRetry={() => start.retry()} />
              <p>You can also choose a folder yourself in the Data area.</p>
            </>
          )}
          {state.phase === "failed" && state.step === "example" && state.problem && (
            <>
              <ImportProblemNotice title="The built-in sample could not be read" problem={state.problem} onRetry={() => start.retry()} />
              <p>You can add your own CSV file in the Data area.</p>
            </>
          )}
          {state.phase === "failed" && state.problem === null && (
            <p>The built-in sample was read, and its reading waits for a confirmation in the Data area.</p>
          )}
          {state.phase === "done" && (
            <p>No cases are open. Add a CSV file in the Data area, or open the cases of a reading listed there.</p>
          )}
          {(state.phase === "failed" || state.phase === "done") && (
            <div>
              <button type="button" className="primary" onClick={onShowData}>
                Go to the Data area
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
