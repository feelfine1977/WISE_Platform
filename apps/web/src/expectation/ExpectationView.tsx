import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { sameJson } from "../data/coordinator";
import { countOf } from "../data/wording";
import type { CaseId, ResolutionDefinition } from "../generated/scoring";
import { type ImportedInvestigationCoordinator, type ImportedInvestigationState, shownSelection } from "../imported/coordinator";
import { contractMethodBuild, type ScoringClient } from "./client";
import { ExpectationCoordinator, type ScoringTarget, shownRun, type ValidationState } from "./coordinator";
import { type DefinitionForm, definitionOf, emptyForm, sameMeaning } from "./definition";
import { ExpectationForm } from "./ExpectationForm";
import { ExpectationResult } from "./ExpectationResult";
import { ExpectationWitness } from "./ExpectationWitness";
import { methodLine } from "./wording";
import "./expectation.css";

interface ExpectationViewProps {
  /** The investigation whose shown incidents are scored. */
  investigation: ImportedInvestigationCoordinator;
  client: ScoringClient;
}

/** The incidents the investigation shows now, with the activities and the clock of their map. */
export interface ScoringSubject {
  target: ScoringTarget;
  caseCount: number;
  activities: string[];
  clockKind: ResolutionDefinition["clock_kind"];
}

/**
 * The incidents of the investigation as a named population: every incident of the preparation
 * while no step is taken, otherwise the incidents the steps keep. Null until the population and its
 * map are answered.
 */
export function scoringSubject(state: ImportedInvestigationState): ScoringSubject | null {
  const population = state.population;
  const shown = shownSelection(state.selection);
  if (population.phase !== "ready" || shown === null) return null;
  const { answer } = population;
  const steps = shown.steps.length;
  return {
    target: {
      workspaceId: answer.workspace_id,
      baseIdentity: answer.identity,
      population:
        steps === 0
          ? { name: `every incident of ${answer.source.filename}`, identity: answer.identity }
          : { name: `the incidents of ${answer.source.filename} kept by ${countOf(steps, "step")}`, identity: shown.answer.identity },
    },
    caseCount: steps === 0 ? answer.population.case_count : shown.answer.kept.case_count,
    activities: shown.graph.nodes.map((node) => node.label).sort((one, other) => one.localeCompare(other)),
    clockKind: shown.graph.meta.timestamp_kind,
  };
}

/** The revision number of the form's definition: the checked one's while the meaning stays, the next one when it changes. */
function revisionFor(form: DefinitionForm, clockKind: ResolutionDefinition["clock_kind"], validation: ValidationState): number {
  if (validation.phase === "idle") return 1;
  const checked = validation.request.definition;
  const candidate = definitionOf(form, clockKind, checked.definition_revision);
  return candidate !== null && !sameMeaning(candidate, checked) ? checked.definition_revision + 1 : checked.definition_revision;
}

/**
 * The Expectation view: one expectation about resolution time stated for the incidents the
 * investigation shows, scored by the method library, with the incidents of each state and the
 * records one score rests on.
 */
export function ExpectationView({ investigation, client }: ExpectationViewProps) {
  const [coordinator] = useState(() => new ExpectationCoordinator(client));
  const investigated = useSyncExternalStore(investigation.subscribe, investigation.getState);
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getState);
  const [form, setForm] = useState<DefinitionForm>(emptyForm);
  const [focusWitness, setFocusWitness] = useState(0);
  const witnessHeading = useRef<HTMLHeadingElement>(null);
  const subject = useMemo(() => scoringSubject(investigated), [investigated]);
  const { validation, run, chosen, witness } = state;

  useEffect(() => () => coordinator.stop(), [coordinator]);

  useEffect(() => {
    if (focusWitness > 0) witnessHeading.current?.focus();
  }, [focusWitness]);

  const definition = subject ? definitionOf(form, subject.clockKind, revisionFor(form, subject.clockKind, validation)) : null;
  const checkedNow =
    subject !== null &&
    definition !== null &&
    validation.phase !== "idle" &&
    sameJson(validation.request.definition, definition) &&
    sameJson(validation.request.named_population, subject.target.population);
  const shown = shownRun(run);

  const openCase = useCallback(
    (caseId: CaseId) => {
      coordinator.openCase(caseId);
      setFocusWitness((count) => count + 1);
    },
    [coordinator],
  );

  useEffect(() => {
    if (witness.phase === "closed") return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || event.target instanceof HTMLSelectElement) return;
      event.preventDefault();
      coordinator.closeCase();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [witness.phase, coordinator]);

  return (
    <main className="expectation" aria-labelledby="expectation-title">
      <div className="expectation-head">
        <h2 id="expectation-title" className="expectation-title">
          Expectation
        </h2>
        <p className="expectation-method-line">{methodLine(contractMethodBuild)}</p>
      </div>
      {subject === null ? (
        <p className="expectation-note">
          An expectation is scored for the incidents an investigation shows. Open the incidents of a preparation in the Data area first; to try it on
          the synthetic example, add the example to a workspace there.
        </p>
      ) : (
        <div className="expectation-body" data-witness={witness.phase === "closed" ? "closed" : "open"}>
          <div className="expectation-main">
            <ExpectationForm
              form={form}
              onChange={setForm}
              activities={subject.activities}
              populationName={subject.target.population.name}
              caseCount={subject.caseCount}
              definition={definition}
              validation={validation}
              checkedNow={checkedNow}
              scoring={run.phase === "loading"}
              onCheck={() => definition && coordinator.check(subject.target, definition)}
              onScore={() => coordinator.score()}
              onRetryCheck={() => coordinator.retryCheck()}
            />
            <ExpectationResult
              run={run}
              chosen={chosen}
              populationId={subject.target.population.identity.population_id}
              openCaseId={witness.phase === "closed" ? null : witness.caseId}
              onChoose={(outcome) => coordinator.choose(outcome)}
              onClear={() => coordinator.clearChoice()}
              onOpen={openCase}
              onRetry={() => coordinator.retryScore()}
            />
          </div>
          {witness.phase !== "closed" && shown && (
            <ExpectationWitness
              witness={witness}
              definition={shown.definition_version.definition}
              onReturn={() => coordinator.closeCase()}
              onRetry={() => coordinator.retryCase()}
              headingRef={witnessHeading}
            />
          )}
        </div>
      )}
    </main>
  );
}
