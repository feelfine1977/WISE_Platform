import { useEffect, useId, useRef, useState } from "react";
import { countOf, utcText, wallText } from "../data/wording";
import type { IntervalDistributionAnswer, IntervalDistributionRequest } from "../generated/interval-tail";
import type { AnswerIdentity, SelectionPredicate } from "../generated/selection";
import { StepPreviewLine, type StepPreviewer } from "../map/StepPreviewLine";
import { httpIntervalClient, type IntervalClient } from "./client";

const POLICY = "incident.interval.first_start_first_response_at_or_after.v1";
/** The bin edges in hours, fixed for every interval, so that the parent's bins never move with a selection. */
export const INTERVAL_EDGES_HOURS = [0, 1, 2, 4, 8, 24, 72, 168, 720];
const CASES_LISTED = 200;

const REASONS: Record<"order_unknown" | "missing_start" | "missing_response", string> = {
  order_unknown: "Order not known: a record has no usable time",
  missing_start: "No start",
  missing_response: "No response at or after the start",
};

interface IntervalPanelProps {
  workspaceId: string;
  revision: number;
  /** The selection shown; its parent fixes the bins. */
  identity: AnswerIdentity;
  /** The activities that can be the start or the response. */
  activities: readonly string[];
  onStep: (step: SelectionPredicate) => void;
  previewStep?: StepPreviewer;
  onOpenCase?: (caseId: string) => void;
  /** The incident open beside the panel, if any; when the one opened from here closes, the focus returns to its button. */
  openCaseId?: string | null;
  waitingFor?: string;
  client?: IntervalClient;
}

type Asked = { start: string; response: string };
type Shown = { phase: "idle" } | { phase: "loading" } | { phase: "ready"; answer: IntervalDistributionAnswer } | { phase: "failed"; message: string };

const hoursText = (hours: number) => `${Number(hours.toFixed(2)).toLocaleString("en")} h`;

/**
 * The one supported interval, from the first record of a start activity to the first record of a response activity at
 * or after it, as the local service measures it: its distribution in bins the parent fixes, the incidents without it by
 * reason, a tail taken from a bin or typed with a strict or inclusive threshold, previewed before it is applied, and the
 * two endpoint records of each incident listed.
 */
export function IntervalPanel({ workspaceId, revision, identity, activities, onStep, previewStep, onOpenCase, openCaseId = null, waitingFor, client = httpIntervalClient }: IntervalPanelProps) {
  const title = useId();
  const previewId = useId();
  const [start, setStart] = useState(activities[0] ?? "");
  const [response, setResponse] = useState(activities[1] ?? activities[0] ?? "");
  const [asked, setAsked] = useState<Asked | null>(null);
  const [shown, setShown] = useState<Shown>({ phase: "idle" });
  const [hours, setHours] = useState("");
  const [operator, setOperator] = useState<"gt" | "ge">("gt");
  const [pending, setPending] = useState<SelectionPredicate | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [witness, setWitness] = useState<string | null>(null);
  const identityKey = JSON.stringify(identity);
  const root = useRef<HTMLElement>(null);
  const opener = useRef<string | null>(null);
  // Back from an incident opened here, the focus returns to the button it was opened with.
  useEffect(() => {
    if (openCaseId !== null || opener.current === null) return;
    const caseId = opener.current;
    opener.current = null;
    [...(root.current?.querySelectorAll<HTMLElement>("[data-open-case]") ?? [])].find((button) => button.dataset.openCase === caseId)?.focus();
  }, [openCaseId]);

  useEffect(() => {
    if (asked === null) return;
    const controller = new AbortController();
    const request: IntervalDistributionRequest = {
      schema_version: 1, message_type: "interval_distribution_request", request_id: `interval-${revision}-${asked.start}-${asked.response}`,
      query_revision: revision, workspace_id: workspaceId, identity,
      interval: { policy: POLICY, start_activity: asked.start, response_activity: asked.response }, edges_hours: INTERVAL_EDGES_HOURS, case_limit: CASES_LISTED,
    };
    setShown({ phase: "loading" });
    client.distribution(request, controller.signal).then((outcome) => {
      if (controller.signal.aborted) return;
      setShown(outcome.ok ? { phase: "ready", answer: outcome.answer }
        : { phase: "failed", message: outcome.problem.kind === "refusal" ? outcome.problem.refusal.message : "The interval could not be read from the local service." });
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, identityKey, revision, workspaceId, client]);

  const interval = asked && { policy: POLICY as typeof POLICY, start_activity: asked.start, response_activity: asked.response };
  const tail = (threshold: number, chosen: "gt" | "ge"): SelectionPredicate | null =>
    interval && { kind: "interval_threshold", interval, operator: chosen, hours: threshold, negate: false };
  const propose = (step: SelectionPredicate | null) => {
    if (!step) return;
    setProblem(null);
    if (previewStep) setPending(step);
    else onStep(step);
  };

  return (
    <section className="view-panel interval-panel" aria-labelledby={title} ref={root}>
      <h3 id={title} className="view-title">Interval between two activities</h3>
      <p className="muted view-hint">
        From the first record of the start activity, in the declared order, to the first record of the response activity at or after its time. Other
        pairings, such as the last start, the final response or cycles, are not offered. This is not the recorded span, the longest gap, active work or a
        completion: only the time between these two records.
      </p>
      <form className="interval-form" onSubmit={(event) => { event.preventDefault(); setPending(null); setWitness(null); setAsked({ start, response }); }}>
        <label>Start activity<select value={start} onChange={(event) => setStart(event.target.value)}>{activities.map((name) => <option key={name}>{name}</option>)}</select></label>
        <label>Response activity<select value={response} onChange={(event) => setResponse(event.target.value)}>{activities.map((name) => <option key={name}>{name}</option>)}</select></label>
        <button type="submit">Measure the interval</button>
      </form>
      {shown.phase === "loading" && <p className="working-text">Measuring the interval of every incident of the parent…</p>}
      {shown.phase === "failed" && <p className="inline-error" role="alert">{shown.message}</p>}
      {shown.phase === "ready" && (
        <Distribution answer={shown.answer} onTail={(threshold) => { setHours(String(threshold)); setOperator("ge"); propose(tail(threshold, "ge")); }}
          onOpen={(caseId, text) => { setWitness(text); opener.current = caseId; onOpenCase?.(caseId); }} canOpen={onOpenCase !== undefined} waitingFor={waitingFor} />
      )}
      {shown.phase === "ready" && (
        <form className="interval-form" aria-label="Tail by threshold" onSubmit={(event) => {
          event.preventDefault();
          const threshold = Number(hours);
          if (!hours.trim() || !Number.isFinite(threshold) || threshold < 0) return setProblem("Enter a finite number of hours, zero or more. Nothing was applied.");
          propose(tail(threshold, operator));
        }}>
          <label>Threshold in hours<input type="number" min="0" step="any" value={hours} onChange={(event) => setHours(event.target.value)} /></label>
          <fieldset>
            <legend>Keep the incidents whose interval is</legend>
            <label className="check"><input type="radio" name={`${title}-operator`} checked={operator === "gt"} onChange={() => setOperator("gt")} />more than the threshold (strict, &gt;)</label>
            <label className="check"><input type="radio" name={`${title}-operator`} checked={operator === "ge"} onChange={() => setOperator("ge")} />at least the threshold (inclusive, ≥)</label>
          </fieldset>
          <button type="submit" disabled={waitingFor !== undefined} aria-describedby={waitingFor}>Preview this tail</button>
          {problem && <p className="inline-error" role="alert">{problem}</p>}
        </form>
      )}
      {pending && previewStep && (
        <div className="filter-preview" role="group" aria-label="Tail not yet applied">
          <StepPreviewLine id={previewId} step={pending} previewer={previewStep} />
          <button type="button" className="primary" disabled={waitingFor !== undefined} aria-describedby={[waitingFor, previewId].filter(Boolean).join(" ")}
            onClick={() => { onStep(pending); setPending(null); }}>
            Apply
          </button>
          <button type="button" onClick={() => setPending(null)}>Cancel</button>
        </div>
      )}
      {witness && <p className="muted interval-witness" role="status">{witness}</p>}
    </section>
  );
}

function Distribution({ answer, onTail, onOpen, canOpen, waitingFor }: {
  answer: IntervalDistributionAnswer; onTail: (threshold: number) => void; onOpen: (caseId: string, witness: string) => void; canOpen: boolean; waitingFor?: string;
}) {
  const { interval, clock, bins, measured, unavailable, cases } = answer;
  const wall = clock.timestamp_kind === "wall_clock";
  const cutoff = wall ? `${wallText(clock.snapshot_cutoff)}, as recorded` : utcText(clock.snapshot_cutoff);
  const most = Math.max(1, ...bins.map((bin) => bin.parent_case_count));
  const label = (start: number, end: number | null) => (end === null ? `${start} h or more` : `${start} h to under ${end} h`);
  const missing = unavailable.reduce((sum, item) => sum + item.kept_case_count, 0);
  return (
    <>
      <p>
        From the first “{interval.start_activity}” to the first “{interval.response_activity}” at or after it, in hours,{" "}
        {wall ? "as differences of recorded wall-clock times, which may differ from the physical elapsed time" : "as elapsed time in UTC"}. Export taken at {cutoff}.
      </p>
      <p className="muted">Policy: <code className="identifier">{interval.policy}</code></p>
      <p>
        Measured: {countOf(measured.kept_case_count, "incident")} of these incidents, {countOf(measured.parent_case_count, "incident")} of the parent.
        Without this interval: {countOf(missing, "incident")} of these incidents; they are in no bin and in no tail.
      </p>
      <table className="plain-table compact-table" aria-label="Incidents without this interval, by reason">
        <thead><tr><th scope="col">Reason</th><th scope="col" className="number">These incidents</th><th scope="col" className="number">Parent</th></tr></thead>
        <tbody>
          {unavailable.map((item) => (
            <tr key={item.reason}><th scope="row">{REASONS[item.reason]}</th><td className="number">{item.kept_case_count}</td><td className="number">{item.parent_case_count}</td></tr>
          ))}
        </tbody>
      </table>
      <table className="plain-table compact-table interval-bins" aria-label="Measured intervals in bins the parent fixes">
        <thead>
          <tr><th scope="col">Interval</th><th scope="col" className="number">These incidents</th><th scope="col" className="number">Parent</th><th scope="col">Bars</th><th scope="col">Tail</th></tr>
        </thead>
        <tbody>
          {bins.map((bin) => (
            <tr key={bin.start_inclusive_hours}>
              <th scope="row">{label(bin.start_inclusive_hours, bin.end_exclusive_hours)}</th>
              <td className="number">{bin.kept_case_count}</td>
              <td className="number">{bin.parent_case_count}</td>
              <td>
                <svg className="share-bars" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                  <rect className="share-track" x="0" y="0" width="100" height="4" />
                  <rect className="share-bar-population" x="0" y="0" width={(bin.kept_case_count / most) * 100} height="4" />
                  <rect className="share-track" x="0" y="6" width="100" height="4" />
                  <rect className="share-bar-parent" x="0" y="6" width={(bin.parent_case_count / most) * 100} height="4" />
                </svg>
              </td>
              <td>
                <button type="button" disabled={waitingFor !== undefined} aria-describedby={waitingFor} onClick={() => onTail(bin.start_inclusive_hours)}>
                  Keep from {bin.start_inclusive_hours} h up
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="interval-cases" aria-label="Intervals of these incidents, longest first">
        {cases.map((item) => {
          const text = item.hours === null
            ? `${item.case_id}: no interval (${REASONS[item.reason!].toLowerCase()}).`
            : `${item.case_id}: from the record at source position ${item.start_source_position} to the record at source position ${item.response_source_position}, ${hoursText(item.hours)}.`;
          return (
            <li key={item.case_id}>
              {text}{" "}
              {canOpen && <button type="button" data-open-case={item.case_id} onClick={() => onOpen(item.case_id, text)}>Open {item.case_id}</button>}
            </li>
          );
        })}
      </ul>
      {answer.cases_truncated && <p className="muted">The {cases.length} longest are listed; the counts above cover every incident.</p>}
    </>
  );
}
