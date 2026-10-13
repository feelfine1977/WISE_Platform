import { useMemo, useState } from "react";
import { countOf } from "../data/wording";
import type { CaseId, CaseVerdict, ScoreRun } from "../generated/scoring";
import { type RunState, shownRun } from "./coordinator";
import { ExpectationProblem } from "./ExpectationProblem";
import { inState, measurementText, type OutcomeState, stateCounts, stateWords, valueText, verdictWords, worstFirst } from "./wording";

/** Rows listed at once; more are listed on request. */
export const ROWS_LISTED = 100;

const valueStates: readonly OutcomeState[] = ["met", "partly", "not_met", "out_of_scope"];
const endpointStates: readonly OutcomeState[] = ["no_start", "no_response"];

interface ExpectationResultProps {
  run: RunState;
  chosen: OutcomeState | null;
  /** The population the investigation shows now; a run of another population says so. */
  populationId: string | null;
  openCaseId: CaseId | null;
  onChoose: (state: OutcomeState) => void;
  onClear: () => void;
  onOpen: (caseId: CaseId) => void;
  onRetry: () => void;
}

/**
 * The run shown: how many incidents are in each state, and the incidents worst first. Choosing a
 * state lists its incidents until the choice is cleared; it is a view of the run, not a selection.
 */
export function ExpectationResult({ run: state, chosen, populationId, openCaseId, onChoose, onClear, onOpen, onRetry }: ExpectationResultProps) {
  const run = shownRun(state);
  return (
    <section className="expectation-result" aria-labelledby="expectation-result-title">
      <h3 id="expectation-result-title" className="expectation-section-title">
        Result
      </h3>
      {state.phase === "idle" && <p className="expectation-muted">Check a reviewed definition and score it to see the result.</p>}
      {state.phase === "loading" && (
        <p role="status" className="expectation-status">
          {run ? "Scoring again; the result below is the previous run." : "The method library is scoring the incidents…"}
        </p>
      )}
      {state.phase === "failed" && <ExpectationProblem title="The incidents could not be scored" problem={state.problem} onRetry={onRetry} />}
      {run && (
        <RunView
          run={run}
          chosen={chosen}
          otherPopulation={populationId !== null && populationId !== run.identity.scored_population_identity.population_id}
          openCaseId={openCaseId}
          onChoose={onChoose}
          onClear={onClear}
          onOpen={onOpen}
        />
      )}
    </section>
  );
}

interface RunViewProps {
  run: ScoreRun;
  chosen: OutcomeState | null;
  otherPopulation: boolean;
  openCaseId: CaseId | null;
  onChoose: (state: OutcomeState) => void;
  onClear: () => void;
  onOpen: (caseId: CaseId) => void;
}

function RunView({ run, chosen, otherPopulation, openCaseId, onChoose, onClear, onOpen }: RunViewProps) {
  const counts = stateCounts(run);
  const definition = run.definition_version.definition;
  const ordered = useMemo(() => worstFirst(run.cases), [run]);
  const listed = useMemo(() => (chosen === null ? ordered : ordered.filter((verdict) => inState(verdict, chosen))), [ordered, chosen]);
  const states = counts.scope_unknown > 0 ? [...valueStates, "scope_unknown" as const] : valueStates;
  return (
    <>
      <p className="expectation-muted">
        Run of {run.named_population.name}: {countOf(run.population.case_count, "incident")} with{" "}
        {countOf(run.population.record_count, "record")}, scored with “{definition.name}”, revision {definition.definition_revision}.
      </p>
      {otherPopulation && (
        <p className="expectation-note">
          The investigation now shows other incidents. This run stays as it was scored; score again to score the incidents shown now.
        </p>
      )}
      <StateGroup label="Incidents by how they meet the expectation" states={states} counts={counts} chosen={chosen} onChoose={onChoose} />
      <StateGroup label="Incidents without an endpoint" states={endpointStates} counts={counts} chosen={chosen} onChoose={onChoose} />
      <p className="expectation-muted">
        Every number counts incidents of this run.{" "}
        {definition.missing_response === "violate"
          ? "An incident without the response counts as not met, so it is counted both under “Do not meet it” and under “Without the response”."
          : "An incident without the start or without the response gets no value."}
      </p>
      <h4 id="expectation-table-title" className="expectation-section-title">
        {chosen === null ? "Incidents, worst first" : `Incidents ${stateWords[chosen].listed}, worst first`}
      </h4>
      {chosen !== null && (
        <div className="expectation-note" role="status">
          <p>
            The table lists the {countOf(counts[chosen], "incident")} {stateWords[chosen].listed}. This is a view of the run: the run and every count
            stay as they are, and nothing is scored again.
          </p>
          <button type="button" onClick={onClear}>
            Show every incident
          </button>
        </div>
      )}
      <IncidentRows key={chosen ?? "every"} cases={listed} openCaseId={openCaseId} onOpen={onOpen} />
    </>
  );
}

interface StateGroupProps {
  label: string;
  states: readonly OutcomeState[];
  counts: Record<OutcomeState, number>;
  chosen: OutcomeState | null;
  onChoose: (state: OutcomeState) => void;
}

function StateGroup({ label, states, counts, chosen, onChoose }: StateGroupProps) {
  return (
    <div className="expectation-states" role="group" aria-label={label}>
      {states.map((state) => (
        <button key={state} type="button" className="expectation-state" aria-pressed={chosen === state} onClick={() => onChoose(state)}>
          <span className="expectation-state-count">{counts[state].toLocaleString("en-GB")}</span>
          <span className="expectation-state-label">{stateWords[state].label}</span>
        </button>
      ))}
    </div>
  );
}

function IncidentRows({ cases, openCaseId, onOpen }: { cases: readonly CaseVerdict[]; openCaseId: CaseId | null; onOpen: (caseId: CaseId) => void }) {
  const [limit, setLimit] = useState(ROWS_LISTED);
  if (cases.length === 0) return <p className="expectation-muted">No incident of the run is in this state.</p>;
  const shown = cases.slice(0, limit);
  return (
    <>
      <table className="expectation-table" aria-labelledby="expectation-table-title">
        <thead>
          <tr>
            <th scope="col">Incident</th>
            <th scope="col">Value</th>
            <th scope="col">State</th>
            <th scope="col">Measured time</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((verdict) => (
            <tr key={verdict.case_id} className={verdict.case_id === openCaseId ? "expectation-row-open" : undefined}>
              <th scope="row">
                <button
                  type="button"
                  className="expectation-case"
                  aria-current={verdict.case_id === openCaseId ? "true" : undefined}
                  onClick={() => onOpen(verdict.case_id)}
                >
                  {verdict.case_id}
                </button>
              </th>
              <td className="expectation-number">{valueText(verdict.value)}</td>
              <td>{verdictWords(verdict)}</td>
              <td>{measurementText(verdict.measurement)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="expectation-muted">
        Listing {countOf(shown.length, "incident")} of {cases.length.toLocaleString("en-GB")}.
      </p>
      {shown.length < cases.length && (
        <button type="button" onClick={() => setLimit((current) => current + ROWS_LISTED)}>
          List {Math.min(ROWS_LISTED, cases.length - shown.length).toLocaleString("en-GB")} more
        </button>
      )}
    </>
  );
}
