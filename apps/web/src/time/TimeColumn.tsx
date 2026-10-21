import { useEffect, useId, useMemo, useRef, useState } from "react";
import { InfoPopover } from "../components/InfoPopover";
import { countOf } from "../data/wording";
import type { CaseListAnswer, CaseListRequest } from "../generated/case-list";
import type { AnswerIdentity, SelectionPredicate } from "../generated/selection";
import type { StartTrendAnswer, StartTrendRequest } from "../generated/start-trend";
import { answersCaseList, type CaseListClient, httpCaseListClient } from "../filters/client";
import { StepPreviewLine, type StepPreviewer } from "../map/StepPreviewLine";
import { stepWording } from "../map/wording";
import { answersStartTrend, httpStartTrendClient, type StartTrendClient } from "./client";
import { type ChartBin, ColumnChart } from "./ColumnChart";
import { dayName, hoursName, type Periods, periodName, SPAN_EDGES_HOURS, spanBinLabel, startPeriods } from "./periods";
import "./time.css";

interface TimeColumnProps {
  workspaceId: string;
  revision: number;
  /** The identity of the kept incidents; their parent is the one they are kept of. */
  identity: AnswerIdentity;
  onStep: (step: SelectionPredicate) => void;
  /** Counts what a step would keep before it is taken; with it a column or band is previewed and applied on request. */
  previewStep?: StepPreviewer;
  waitingFor?: string;
  caseLists?: CaseListClient;
  trends?: StartTrendClient;
}

type Loaded<T> = { phase: "loading" } | { phase: "ready"; answer: T } | { phase: "failed"; message: string };

const problemText = (refusal: { message: string } | null) => refusal?.message ?? "It could not be read from the local service.";

/**
 * Beside the map, what selects by time: the recorded spans of the incidents and the periods their
 * first records lie in, each the parent pale and the kept incidents solid, in bins the parent
 * fixes. A column or a band taken from a chart is a step: previewed first where a preview can be counted, then applied.
 */
export function TimeColumn({ workspaceId, revision, identity, onStep, previewStep, waitingFor, caseLists = httpCaseListClient, trends = httpStartTrendClient }: TimeColumnProps) {
  const asked = useId();
  const previewId = useId();
  const [pending, setPending] = useState<SelectionPredicate | null>(null);
  const propose = (step: SelectionPredicate) => (previewStep ? setPending(step) : onStep(step));
  const [spans, setSpans] = useState<Loaded<CaseListAnswer>>({ phase: "loading" });
  const [starts, setStarts] = useState<Loaded<StartTrendAnswer>>({ phase: "loading" });
  // A failed question is asked again on request, for the same kept incidents: nothing of the selection changes.
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt((count) => count + 1);
  const identityKey = JSON.stringify(identity);

  useEffect(() => {
    const controller = new AbortController();
    const request: CaseListRequest = {
      schema_version: 1, message_type: "case_list_request", request_id: `spans-${asked}-${revision}-${attempt}`, query_revision: revision,
      workspace_id: workspaceId, identity,
      query: { search_text: null, sort: { field: "case_id", direction: "ascending" }, offset: 0, limit: 1, distribution: { measure: "observed_span_hours", edges_hours: SPAN_EDGES_HOURS } },
    };
    setSpans({ phase: "loading" });
    caseLists.list(request, controller.signal).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        if (outcome.ok && answersCaseList(request, outcome.answer)) setSpans({ phase: "ready", answer: outcome.answer });
        else setSpans({ phase: "failed", message: problemText(!outcome.ok && outcome.problem.kind === "refusal" ? outcome.problem.refusal : null) });
      },
      () => !controller.signal.aborted && setSpans({ phase: "failed", message: problemText(null) }),
    );
    return () => controller.abort();
    // The identity is compared by its contents, not by the object that carries it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseLists, workspaceId, revision, identityKey, asked, attempt]);

  // The periods are fixed by the parent's recorded range, which stays the same through every step.
  const range = spans.phase === "ready" ? spans.answer.parent_time_range : null;
  const rangeKey = JSON.stringify(range);
  const periods: Periods | null = useMemo(() => (range === null ? null : startPeriods(range)), [rangeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (periods === null || range === null) return;
    const controller = new AbortController();
    const binning = range.timestamp_kind === "utc_instant"
      ? { kind: "explicit_edges" as const, timestamp_kind: "utc_instant" as const, edges: periods.edges }
      : { kind: "explicit_edges" as const, timestamp_kind: "wall_clock" as const, edges: periods.edges };
    const request: StartTrendRequest = {
      schema_version: 1, message_type: "start_trend_request", request_id: `starts-${asked}-${revision}-${attempt}`, query_revision: revision,
      workspace_id: workspaceId, identity, definition: { policy_id: "incident.start_trend.first_raw_declared_order_half_open.v1", binning },
    };
    setStarts({ phase: "loading" });
    trends.trend(request, controller.signal).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        if (outcome.ok && answersStartTrend(request, outcome.answer)) setStarts({ phase: "ready", answer: outcome.answer });
        else setStarts({ phase: "failed", message: problemText(!outcome.ok && outcome.problem.kind === "refusal" ? outcome.problem.refusal : null) });
      },
      () => !controller.signal.aborted && setStarts({ phase: "failed", message: problemText(null) }),
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trends, workspaceId, revision, identityKey, periods, asked, attempt]);

  const per = periods?.per ?? "week";

  return (
    <section className="time-column" aria-label="Time of the kept incidents">
      <div className="time-column-head">
        <h4 className="time-column-title">Time</h4>
        <InfoPopover label="About these charts">
          <p className="about-lead">Each column counts incidents, each incident once per chart: the kept incidents solid, the parent's pale.</p>
          <section className="popover-section">
            <p>
              Recorded span: the time from the first to the last record of an incident, over its whole history. An incident with one record has a
              span of zero and no longest gap; an incident whose order of records is not known has neither.
            </p>
            <p>
              Starts: each incident counts once, in the {per} of its first record in the declared order. The periods are fixed by the parent: weeks
              from Monday, or months, quarters or years where the parent spans more than 64 weeks. Records per period are not shown yet.
            </p>
            <p>
              Pale columns are the parent, solid columns the kept incidents. A column of spans keeps the incidents of at least that span; a band of
              periods keeps the incidents whose first record lies in it, with all their later records. Each is a step, and Undo takes it back.
            </p>
            {starts.phase === "ready" && (
              <p>
                {starts.answer.clock.timestamp_kind === "wall_clock"
                  ? "Times are read as recorded, without a time zone (wall clock)."
                  : "Times are UTC instants."}{" "}
                The data reach {dayName(starts.answer.clock.snapshot_cutoff)}.
              </p>
            )}
          </section>
        </InfoPopover>
      </div>
      <SpanChart state={spans} onStep={propose} waitingFor={waitingFor} onRetry={retry} />
      <StartsChart state={startsState(spans, range, periods, starts)} per={per} onStep={propose} waitingFor={waitingFor} onRetry={retry} />
      {pending && previewStep && (
        <div className="filter-preview" role="group" aria-label="Step from the time charts not yet applied">
          <p>{stepWording(pending)}</p>
          <StepPreviewLine id={previewId} step={pending} previewer={previewStep} />
          <button type="button" className="primary" disabled={waitingFor !== undefined} aria-describedby={[waitingFor, previewId].filter(Boolean).join(" ")}
            onClick={() => { onStep(pending); setPending(null); }}>
            Apply
          </button>
          <button type="button" onClick={() => setPending(null)}>Cancel</button>
        </div>
      )}
    </section>
  );
}

/**
 * What the chart of starts can show: the periods come from the parent's range the spans answer
 * reads, so without that answer, without a usable time or without periods there is nothing to ask,
 * and the chart says why instead of waiting.
 */
function startsState(spans: Loaded<CaseListAnswer>, range: CaseListAnswer["parent_time_range"], periods: Periods | null, starts: Loaded<StartTrendAnswer>): Loaded<StartTrendAnswer> | { phase: "unasked"; message: string } {
  if (spans.phase === "failed") return { phase: "failed", message: "the recorded range of the parent could not be read" };
  if (spans.phase === "loading") return { phase: "loading" };
  if (range === null) return { phase: "unasked", message: "no record of the parent has a usable time" };
  if (periods === null) return { phase: "unasked", message: "the recorded range of the parent cannot be divided into periods of the calendar" };
  return starts;
}

/** Why a chart is not shown, and the way to ask again where asking again can help. */
function NotShown({ what, message, onRetry }: { what: string; message: string; onRetry?: () => void }) {
  return (
    <div className="time-chart-problem" role="status">
      <p>
        {what} are not shown: {message}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Ask again
        </button>
      )}
    </div>
  );
}

function SpanChart({ state, onStep, waitingFor, onRetry }: { state: Loaded<CaseListAnswer>; onStep: (step: SelectionPredicate) => void; waitingFor?: string; onRetry: () => void }) {
  const title = useId();
  const distribution = state.phase === "ready" ? state.answer.distribution : null;
  const bins: ChartBin[] = (distribution?.bins ?? []).map((bin) => ({
    label: spanBinLabel(bin.start_inclusive_hours, bin.end_exclusive_hours),
    parent: bin.parent_case_count,
    kept: bin.kept_case_count,
  }));
  const startOf = (place: number) => distribution?.bins[place]?.start_inclusive_hours ?? 0;
  return (
    <section className="time-chart" aria-labelledby={title}>
      <h5 id={title} className="time-chart-title">Incidents by recorded span</h5>
      {state.phase === "loading" && <p className="working-text">Counting spans…</p>}
      {state.phase === "failed" && <NotShown what="Spans" message={state.message} onRetry={onRetry} />}
      {distribution !== null && (
        <>
          <ColumnChart
            name="Incidents by recorded span"
            bins={bins}
            band={false}
            applicable={(from) => startOf(from) > 0}
            chosenName={(from) => bins[from].label}
            stepName={(from) => `Keep incidents with a span of at least ${hoursName(startOf(from))}`}
            onApply={(from) => onStep({ kind: "observed_span_at_least", hours: startOf(from), negate: false })}
            waitingFor={waitingFor}
            ticks={[bins[0]?.label ?? "", bins.at(-1)?.label ?? ""]}
          />
          {distribution.unavailable.kept_case_count > 0 && (
            <p className="time-chart-limit">{countOf(distribution.unavailable.kept_case_count, "incident")} without a span</p>
          )}
        </>
      )}
    </section>
  );
}

function StartsChart({ state, per, onStep, waitingFor, onRetry }: { state: Loaded<StartTrendAnswer> | { phase: "unasked"; message: string }; per: string; onStep: (step: SelectionPredicate) => void; waitingFor?: string; onRetry: () => void }) {
  const title = useId();
  const [expanded, setExpanded] = useState(false);
  const expand = useRef<HTMLButtonElement>(null);
  const close = () => {
    setExpanded(false);
    // Closing the expanded view returns the focus to the control that opened it.
    requestAnimationFrame(() => expand.current?.focus());
  };
  const answer = state.phase === "ready" ? state.answer : null;
  const bins: ChartBin[] = (answer?.bins ?? []).map((bin) => ({
    label: periodName(bin.start_inclusive, bin.end_exclusive),
    parent: bin.parent_support.case_count,
    kept: bin.kept_support.case_count,
  }));
  const window = (from: number, to: number): SelectionPredicate | null => {
    if (answer === null) return null;
    // The bounds are exactly the ones the service answered for these periods, on its clock.
    const start_inclusive = answer.bins[from].start_inclusive;
    const end_exclusive = answer.bins[to].end_exclusive;
    return {
      kind: "case_start_in_window",
      window: answer.clock.timestamp_kind === "utc_instant" ? { timestamp_kind: "utc_instant", start_inclusive, end_exclusive } : { timestamp_kind: "wall_clock", start_inclusive, end_exclusive },
      negate: false,
    };
  };
  const outside = answer === null ? 0 : answer.before_range.kept_support.case_count + answer.after_range.kept_support.case_count;
  return (
    <section className="time-chart" aria-labelledby={title}>
      <h5 id={title} className="time-chart-title">Incident starts per {per}</h5>
      {state.phase === "loading" && <p className="working-text">Counting starts…</p>}
      {state.phase === "failed" && <NotShown what="Starts" message={state.message} onRetry={onRetry} />}
      {state.phase === "unasked" && <NotShown what="Starts" message={state.message} />}
      {answer !== null && (
        <>
          <ColumnChart
            name={`Incident starts per ${per}`}
            bins={bins}
            band
            applicable={() => true}
            chosenName={(from, to) => periodName(answer.bins[from].start_inclusive, answer.bins[to].end_exclusive)}
            stepName={(from, to) => `Keep incidents that start from ${periodName(answer.bins[from].start_inclusive, answer.bins[to].end_exclusive)}`}
            onApply={(from, to) => {
              const step = window(from, to);
              if (step !== null) onStep(step);
            }}
            waitingFor={waitingFor}
            ticks={[bins.length > 0 ? dayName(answer.bins[0].start_inclusive) : "", bins.length > 0 ? periodName(answer.bins.at(-1)!.start_inclusive, answer.bins.at(-1)!.end_exclusive).split(" to ")[1] : ""]}
          />
          {answer.unevaluable.kept_support.case_count > 0 && (
            <p className="time-chart-limit">{countOf(answer.unevaluable.kept_support.case_count, "incident")} without a first time</p>
          )}
          {outside > 0 && <p className="time-chart-limit">{countOf(outside, "incident")} start outside these periods</p>}
          <p className="muted time-chart-note">
            Each incident counts once, at the time of its first record in the declared order, not at its first labelled activity. A period includes its start
            and excludes its end, {answer.clock.timestamp_kind === "wall_clock" ? "on the wall clock as recorded" : "in UTC"}; the export was taken at{" "}
            {answer.clock.timestamp_kind === "wall_clock" ? answer.clock.snapshot_cutoff.replace("T", " ") : answer.clock.snapshot_cutoff.replace("T", " ").replace("Z", " UTC")}.
          </p>
          <p className="muted time-chart-note">
            Incidents that started shortly before the export have had little time to be resolved or reopened: a recent period with fewer late records does
            not by itself show an improvement.
          </p>
          <button type="button" ref={expand} aria-expanded={expanded} onClick={() => setExpanded(true)}>
            Expand the starts
          </button>
          {expanded && (
            <section className="time-expanded" aria-label={`Incident starts per ${per}, expanded`}>
              <table className="plain-table compact-table">
                <caption className="caption">Incident starts per {per}, with these incidents and the parent</caption>
                <thead>
                  <tr><th scope="col">Period</th><th scope="col" className="number">These incidents</th><th scope="col" className="number">Parent</th><th scope="col">Step</th></tr>
                </thead>
                <tbody>
                  {answer.bins.map((bin, place) => (
                    <tr key={bin.start_inclusive}>
                      <th scope="row">{periodName(bin.start_inclusive, bin.end_exclusive)}</th>
                      <td className="number">{bin.kept_support.case_count}</td>
                      <td className="number">{bin.parent_support.case_count}</td>
                      <td>
                        <button type="button" disabled={waitingFor !== undefined} aria-describedby={waitingFor}
                          onClick={() => { const step = window(place, place); if (step !== null) { onStep(step); close(); } }}>
                          Keep incidents that start in {periodName(bin.start_inclusive, bin.end_exclusive)}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" onClick={close}>Close the expanded starts</button>
            </section>
          )}
        </>
      )}
    </section>
  );
}
