import type { FormEvent, ReactNode } from "react";
import { countOf } from "../data/wording";
import type { ResolutionDefinition } from "../generated/scoring";
import type { ValidationState } from "./coordinator";
import { type DefinitionForm, formProblems } from "./definition";
import { ExpectationProblem } from "./ExpectationProblem";
import { blockerPlace, definitionSentence, type MissingMeaning, readHours } from "./wording";

interface ExpectationFormProps {
  form: DefinitionForm;
  onChange: (form: DefinitionForm) => void;
  /** The activities of the population, to choose the start and the response from. */
  activities: readonly string[];
  populationName: string;
  caseCount: number;
  /** The definition the form makes now, or null while the form has problems. */
  definition: ResolutionDefinition | null;
  validation: ValidationState;
  /** Whether the check shown is the check of the definition and the incidents of the form now. */
  checkedNow: boolean;
  scoring: boolean;
  waiting: boolean;
  onCheck: () => void;
  onScore: () => void;
  onRetryCheck: () => void;
}

const meanings: { value: MissingMeaning; label: string }[] = [
  { value: "violate", label: "Counted as not met" },
  { value: "skip", label: "Left without a value" },
];

/**
 * The definition of one expectation: two activities of the population, a target and a width in
 * hours, and what a missing response means, repeated as one sentence. Checking asks the local
 * service whether the method library can score it; only a checked, reviewed definition is scored.
 */
export function ExpectationForm(props: ExpectationFormProps) {
  const { form, onChange, activities, populationName, caseCount, definition, validation, checkedNow, scoring, waiting } = props;
  const problems = formProblems(form);
  const target = readHours(form.target);
  const width = readHours(form.width);
  const set = <Field extends keyof DefinitionForm>(field: Field, value: DefinitionForm[Field]) => onChange({ ...form, [field]: value });
  const ready = checkedNow && validation.phase === "ready" && validation.answer.state === "ready";
  const reviewed = definition?.review_state === "reviewed";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (definition) props.onCheck();
  }

  return (
    <form className="expectation-form" aria-labelledby="expectation-form-title" onSubmit={submit} noValidate>
      <h3 id="expectation-form-title" className="expectation-section-title">
        Definition
      </h3>
      <p className="expectation-muted">
        Scored for {populationName}: {countOf(caseCount, "incident")}. Times are hours on the clock of the preparation.
      </p>
      <ol className="expectation-guide" aria-label="How an expectation is scored">
        <li>Say what is expected: the activity that starts the time, the activity expected after it, and the target in hours.</li>
        <li>Say who stands behind it: a name, an owner, a source and the reason. They are kept with every result.</li>
        <li>Tick that you have reviewed it, then choose "Check the definition".</li>
        <li>Choose "Score" for the incidents named above. Nothing is scored before that.</li>
      </ol>
      <div className="expectation-fields">
        <Field id="expectation-start" label="Start activity">
          <select id="expectation-start" className="expectation-select" value={form.start} onChange={(event) => set("start", event.target.value)}>
            <option value="">Choose…</option>
            {activities.map((activity) => (
              <option key={activity} value={activity}>
                {activity}
              </option>
            ))}
          </select>
        </Field>
        <Field id="expectation-response" label="Response activity">
          <select
            id="expectation-response"
            className="expectation-select"
            value={form.response}
            onChange={(event) => set("response", event.target.value)}
          >
            <option value="">Choose…</option>
            {activities.map((activity) => (
              <option key={activity} value={activity}>
                {activity}
              </option>
            ))}
          </select>
        </Field>
        <Field id="expectation-target" label="Target (hours)">
          <input
            id="expectation-target"
            className="expectation-input"
            inputMode="decimal"
            value={form.target}
            onChange={(event) => set("target", event.target.value)}
          />
        </Field>
        <Field id="expectation-width" label="Width (hours partly met after the target)">
          <input
            id="expectation-width"
            className="expectation-input"
            inputMode="decimal"
            value={form.width}
            onChange={(event) => set("width", event.target.value)}
          />
        </Field>
      </div>
      <fieldset className="expectation-choice">
        <legend>An incident with the start but without a response</legend>
        {meanings.map((meaning) => (
          <label key={meaning.value} className="expectation-option">
            <input type="radio" name="expectation-missing" value={meaning.value} checked={form.missing === meaning.value} onChange={() => set("missing", meaning.value)} />
            {meaning.label}
          </label>
        ))}
      </fieldset>
      <p className="expectation-sentence" aria-live="polite">
        {form.start && form.response && target !== null && width !== null
          ? definitionSentence({ start: form.start, response: form.response, target, width, missing: form.missing })
          : "Choose two activities and enter a target to read the expectation as one sentence."}
      </p>
      <div className="expectation-fields">
        <Field id="expectation-name" label="Name">
          <input id="expectation-name" className="expectation-input" value={form.name} onChange={(event) => set("name", event.target.value)} />
        </Field>
        <Field id="expectation-owner" label="Owner">
          <input id="expectation-owner" className="expectation-input" value={form.owner} onChange={(event) => set("owner", event.target.value)} />
        </Field>
        <Field id="expectation-source" label="Source (for example a service agreement)">
          <input
            id="expectation-source"
            className="expectation-input"
            value={form.sourceLabel}
            onChange={(event) => set("sourceLabel", event.target.value)}
          />
        </Field>
      </div>
      <Field id="expectation-rationale" label="Rationale">
        <textarea
          id="expectation-rationale"
          className="expectation-textarea"
          value={form.rationale}
          onChange={(event) => set("rationale", event.target.value)}
        />
      </Field>
      <label className="expectation-option">
        <input type="checkbox" checked={form.reviewed} onChange={(event) => set("reviewed", event.target.checked)} />
        I have reviewed this definition. This is a local mark, not a sign-in; a draft can be checked but not scored.
      </label>
      {problems.length > 0 && (
        <ul className="expectation-form-problems" aria-label="Still to fill in">
          {problems.map((problem) => (
            <li key={problem.field}>{problem.message}</li>
          ))}
        </ul>
      )}
      <div className="expectation-actions">
        <button type="submit" disabled={waiting || definition === null || validation.phase === "loading"}>
          Check the definition
        </button>
        <button type="button" className="expectation-primary" disabled={waiting || !ready || !reviewed || scoring} onClick={props.onScore}>
          Score {countOf(caseCount, "incident")}
        </button>
      </div>
      <CheckOutcome validation={validation} checkedNow={checkedNow} reviewed={reviewed} onRetry={props.onRetryCheck} />
    </form>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="expectation-field">
      <label htmlFor={id} className="expectation-label">
        {label}
      </label>
      {children}
    </div>
  );
}

function CheckOutcome({ validation, checkedNow, reviewed, onRetry }: { validation: ValidationState; checkedNow: boolean; reviewed: boolean; onRetry: () => void }) {
  if (validation.phase === "idle") return null;
  if (validation.phase === "loading") {
    return (
      <p role="status" className="expectation-status">
        Checking the definition with the method library…
      </p>
    );
  }
  if (validation.phase === "failed") return <ExpectationProblem title="The definition could not be checked" problem={validation.problem} onRetry={onRetry} />;
  const { answer } = validation;
  const stale = checkedNow ? null : <p className="expectation-muted">The definition or the incidents changed since this check. Check again to score.</p>;
  if (answer.state === "ready") {
    return (
      <div role="status" className="expectation-ready">
        <p>
          <strong>Ready.</strong> The method library accepts this definition for these incidents.{" "}
          {reviewed ? "It can be scored." : "It is a draft: it can be explored but not scored. Mark it as reviewed and check it again to score it."}
        </p>
        {stale}
      </div>
    );
  }
  return (
    <div role="alert" className="expectation-blocked">
      <p>
        <strong>Not ready.</strong> The definition cannot be scored for these incidents:
      </p>
      <ul>
        {answer.blockers.map((blocker, index) => (
          <li key={`${blocker.field}-${index}`}>
            <span className="expectation-label">{blockerPlace(blocker)}</span> {blocker.message}
          </li>
        ))}
      </ul>
      {stale}
    </div>
  );
}
