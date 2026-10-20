import { useEffect, useRef, useState } from "react";
import { countOf, describeImportProblem } from "../data/wording";
import type { GroupComparisonAnswer } from "../generated/comparison";
import type { ImportedCaseEvidenceAnswer } from "../generated/imports";
import type { OutcomeRatesAnswer } from "../generated/outcome";
import type { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { RecordsTable } from "../pinned/PairedHistories";
import { contextPolicy, type OutcomeChoice } from "./coordinator";
import { httpOutcomeClient, type OutcomeClient } from "./outcomeClient";
import { valueText } from "./wording";

const OUTCOME_POLICY = "incident.outcome.recorded_activity_presence_at_snapshot.v1";
const percent = new Intl.NumberFormat("en", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const twoDecimals = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The name of an outcome as what the export records: a presence or an absence, never a business state. */
export function outcomeName(activity: string, counted: "presence" | "absence"): string {
  return counted === "absence" ? `No recorded “${activity}”` : `Recorded “${activity}”`;
}

/** A value's rate of O beside the parent's, or why it has none. */
export function liftText(lift: OutcomeRatesAnswer["categories"][number]["lift"]): string {
  if (lift.status === "available") return twoDecimals.format(lift.value);
  if (lift.reason === "zero_parent_rate") return "not available: the parent's rate is 0";
  if (lift.reason === "empty_category") return "not available: no incident of this value is known";
  return "not available: the outcome is not recorded in this source";
}

type Shown = { phase: "idle" } | { phase: "loading" } | { phase: "ready"; answer: OutcomeRatesAnswer } | { phase: "failed"; message: string };

interface OutcomeSectionProps {
  /** The comparison shown: its parent is the outcome's, and its roles do not change it. */
  answer: GroupComparisonAnswer;
  columnName: string;
  /** The activities of the source, to name an outcome by. */
  activities: string[];
  investigation: ImportedInvestigationCoordinator;
  client?: OutcomeClient;
  /** The outcome named, kept with the question when it is saved; one restored from a saved investigation is asked again. */
  chosen?: OutcomeChoice | null;
  onChoose?: (outcome: OutcomeChoice) => void;
}

/**
 * A separately named outcome O over the comparison's parent: whether each incident's complete history records an
 * activity at the snapshot, counted as its presence or absence; its known subset; its rate by the value the incidents
 * were first recorded with, beside the parent's rate. It is independent of the groups A and B and of their roles. Each
 * value's witnesses (with O) and counterexamples (without O) open their complete histories in the parent.
 */
export function OutcomeSection({ answer, columnName, activities, investigation, client = httpOutcomeClient, chosen = null, onChoose }: OutcomeSectionProps) {
  const restored = chosen !== null && chosen.column === answer.context_column_index ? chosen : null;
  const [activity, setActivity] = useState(restored?.activity ?? (activities.includes("Resolved") ? "Resolved" : activities[0] ?? ""));
  const [counted, setCounted] = useState<"presence" | "absence">(restored?.counted ?? "absence");
  const [asked, setAsked] = useState<{ activity: string; counted: "presence" | "absence"; attempt: number } | null>(
    restored ? { activity: restored.activity, counted: restored.counted, attempt: 1 } : null,
  );
  const [shown, setShown] = useState<Shown>({ phase: "idle" });
  const [listed, setListed] = useState<{ value: string | null; with: boolean } | null>(null);
  const [open, setOpen] = useState<{ caseId: string; loaded: ImportedCaseEvidenceAnswer | string | null } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const parentKey = JSON.stringify(answer.parent_identity);
  useEffect(() => {
    if (asked === null) return;
    const controller = new AbortController();
    setShown({ phase: "loading" });
    client
      .rates({ schema_version: 1, message_type: "outcome_rates_request", request_id: `outcome-${answer.query_revision}-${asked.attempt}`, query_revision: answer.query_revision,
        workspace_id: answer.workspace_id, identity: answer.parent_identity, context_column_index: answer.context_column_index, context_policy: contextPolicy,
        outcome: { policy: OUTCOME_POLICY, activity: asked.activity, counted: asked.counted } }, controller.signal)
      .then((outcome) => {
        if (controller.signal.aborted) return;
        setShown(outcome.ok ? { phase: "ready", answer: outcome.answer } : { phase: "failed", message: outcome.problem.kind === "refusal" ? outcome.problem.refusal.message : "The outcome could not be read from the local service." });
      });
    return () => controller.abort();
    // The parent is compared by its identity, and the column by its index.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, parentKey, answer.context_column_index]);
  useEffect(() => {
    if (open && open.loaded !== null) heading.current?.focus();
  }, [open]);
  async function openCase(caseId: string, element: HTMLElement) {
    opener.current = element;
    setOpen({ caseId, loaded: null });
    const outcome = await investigation.evidenceIn(answer.parent_identity, caseId, new AbortController().signal);
    setOpen({ caseId, loaded: outcome.ok ? outcome.answer : describeImportProblem(outcome.problem).message });
  }
  function close() {
    setOpen(null);
    const element = opener.current;
    requestAnimationFrame(() => element?.focus());
  }
  const name = asked ? outcomeName(asked.activity, asked.counted) : outcomeName(activity, counted);
  return (
    <section className="compare-outcome" aria-labelledby="compare-outcome-title">
      <h4 id="compare-outcome-title">Outcome by opening value</h4>
      <p className="compare-muted">
        An outcome is named apart from the groups: whether each incident of the parent has a record of an activity in the export, at its snapshot cutoff.
        Its rate by the value the incidents were first recorded with is set beside the parent's rate. Durations are not offered as an outcome here.
      </p>
      <div className="compare-outcome-choice">
        <label>
          Activity of the outcome
          <select value={activity} onChange={(event) => setActivity(event.target.value)}>
            {activities.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Count as the outcome</legend>
          <label><input type="radio" name="outcome-counted" checked={counted === "absence"} onChange={() => setCounted("absence")} />its absence: {outcomeName(activity, "absence")}</label>
          <label><input type="radio" name="outcome-counted" checked={counted === "presence"} onChange={() => setCounted("presence")} />its presence: {outcomeName(activity, "presence")}</label>
        </fieldset>
        <button type="button" disabled={activity === ""} onClick={() => {
          setListed(null);
          setOpen(null);
          setAsked({ activity, counted, attempt: (asked?.attempt ?? 0) + 1 });
          onChoose?.({ activity, counted, column: answer.context_column_index });
        }}>
          Show the outcome by value
        </button>
      </div>
      {shown.phase === "loading" && <p className="working-text">Reading the outcome of every incident of the parent…</p>}
      {shown.phase === "failed" && <p role="alert">{shown.message}</p>}
      {shown.phase === "ready" && (
        <OutcomeTable answer={shown.answer} name={name} columnName={columnName} listed={listed} onList={setListed} onOpen={openCase} />
      )}
      {open && (
        <section className="compare-history" aria-labelledby="outcome-history-title" onKeyDown={(event) => event.key === "Escape" && close()}>
          <h4 id="outcome-history-title" tabIndex={-1} ref={heading}>
            Incident <span className="identifier">{open.caseId}</span>, of the parent
          </h4>
          {open.loaded === null ? <p className="working-text">Reading every record of {open.caseId}…</p>
            : typeof open.loaded === "string" ? <p role="alert">{open.loaded}</p> : <RecordsTable answer={open.loaded} />}
          <button type="button" onClick={close}>Return to the outcome</button>
        </section>
      )}
    </section>
  );
}

function OutcomeTable({ answer, name, columnName, listed, onList, onOpen }: {
  answer: OutcomeRatesAnswer; name: string; columnName: string; listed: { value: string | null; with: boolean } | null;
  onList: (listed: { value: string | null; with: boolean } | null) => void; onOpen: (caseId: string, element: HTMLElement) => void;
}) {
  if (answer.status === "unavailable") {
    return (
      <p className="compare-problem" role="note">
        No record of “{answer.outcome.activity}” is in this source, so it names no outcome: the {countOf(answer.unknown_case_count, "incident")} of the parent have an
        unknown outcome, not a favourable or an unfavourable one.
      </p>
    );
  }
  const chosen = listed === null ? null : answer.categories.find((category) => category.value === listed.value) ?? null;
  const ids = chosen === null || listed === null ? [] : listed.with ? chosen.counted_case_ids : chosen.other_case_ids;
  return (
    <>
      <p>
        Outcome O: <strong>{name}</strong> at the snapshot cutoff {answer.snapshot_cutoff.replace("T", " ").replace("Z", " UTC")}. Known for{" "}
        {countOf(answer.known_case_count, "incident")} of the {countOf(answer.parent_case_count, "incident")} of the parent (K
        {answer.known_case_count === answer.parent_case_count ? " = P" : ""}): whether a history holds a record is always known, even where the business state of the
        incident is not. In the parent, O holds for {answer.counted_case_count} of {answer.known_case_count} ({answer.rate === null ? "no rate" : percent.format(answer.rate)}).
      </p>
      {answer.outcome.counted === "absence" && (
        <p className="compare-muted">“{name}” says only that the export holds no such record: it is not a verdict that the incident is unresolved or open.</p>
      )}
      <div className="compare-scroll">
        <table className="compare-table" aria-label={`${name} by the first recorded ${columnName}`}>
          <thead>
            <tr>
              <th scope="col">First recorded {columnName}</th>
              <th scope="col">Known incidents</th>
              <th scope="col">With O</th>
              <th scope="col">Rate of O</th>
              <th scope="col">Rate ÷ parent rate</th>
              <th scope="col"><span className="compare-hidden">Incidents</span></th>
            </tr>
          </thead>
          <tbody>
            {answer.categories.map((category) => {
              const label = valueText(category.value);
              return (
                <tr key={JSON.stringify(category.value)}>
                  <th scope="row">{label}</th>
                  <td>{category.known_case_count}</td>
                  <td>{category.counted_case_ids.length}</td>
                  <td>{category.rate === null ? "—" : `${category.counted_case_ids.length} of ${category.known_case_count} (${percent.format(category.rate)})`}</td>
                  <td>{liftText(category.lift)}</td>
                  <td>
                    <button type="button" className="compare-step" onClick={() => onList({ value: category.value, with: true })}>Witnesses with O for {label}</button>
                    <button type="button" className="compare-step" onClick={() => onList({ value: category.value, with: false })}>Counterexamples without O for {label}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="compare-muted">
        The rate ÷ parent rate compares the outcome within a value with the outcome in the whole parent. It is not the ratio of shares above, which compares how
        often a value occurs in A and in B. Neither is a cause or a risk.
      </p>
      {listed !== null && chosen !== null && (
        <div>
          <p>
            {listed.with ? "Witnesses" : "Counterexamples"}: the incidents first recorded with {columnName} {valueText(chosen.value)} {listed.with ? "with" : "without"} O.{" "}
            <button type="button" className="link-button" onClick={() => onList(null)}>Close the list</button>
          </p>
          <ul className="compare-side-list" aria-label={`${listed.with ? "Witnesses" : "Counterexamples"} for ${valueText(chosen.value)}`}>
            {ids.map((caseId) => (
              <li key={caseId}>
                <span className="identifier">{caseId}</span>{" "}
                <button type="button" className="link-button" onClick={(event) => onOpen(caseId, event.currentTarget)}>Open {caseId}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
