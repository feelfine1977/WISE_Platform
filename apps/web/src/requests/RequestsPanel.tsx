import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatHours } from "wise-flow";
import { countOf } from "../data/wording";
import type { AnswerIdentity } from "../generated/selection";
import type { StageProposalAnswer } from "../generated/stage-proposal";
import type { UnansweredRequestsAnswer } from "../generated/unanswered-requests";
import { httpProposalClient, type ProposalClient } from "../stages/proposalClient";
import { httpRequestsClient, type RequestsClient } from "./client";
import { browserRequests, definitionOf, definitionWords, draftProblem, type RequestsDraft, type RequestsStore, useRequests } from "./definitions";

/** How many incidents without a later answer are listed, the longest without a further record first. */
export const CASES_LISTED = 200;

interface RequestsPanelProps {
  workspaceId: string;
  preparationId: string;
  /** The kept incidents shown: the definition is read over them. */
  identity: AnswerIdentity;
  revision: number;
  /** The activities of the reading, the most frequent first. */
  activities: readonly string[];
  columns: readonly { index: number; name: string }[];
  /** Opens the complete history of an incident with the last request marked. */
  onOpenCase: (caseId: string, rowIds: string[]) => void;
  openCaseId: string | null;
  client?: RequestsClient;
  proposalClient?: ProposalClient;
  store?: RequestsStore;
}

type Read<T> = { phase: "idle" } | { phase: "loading" } | { phase: "ready"; answer: T } | { phase: "failed"; message: string };

/** A time as the export wrote it, on its clock: "2026-10-10 10:00 UTC" or "2026-10-10 10:00, as recorded". */
const when = (time: string, kind: "utc_instant" | "wall_clock") =>
  kind === "utc_instant" ? `${time.replace("T", " ").replace(/:00(\.\d+)?Z$/, "").replace(/Z$/, "")} UTC` : `${time.replace("T", " ").replace(/:00(\.\d+)?$/, "")}, as recorded`;

/**
 * Requests without an answer, by the analyst's definitions: which activities are requests and which are answers, whose
 * turn a request is on, and after how long a gap a record starts a new matter. The definition is said in words and must
 * be reviewed before it is read; it can be proposed from the values of a turn column. The local service lists the kept
 * incidents whose last request in their latest matter has no later answer, with that request as evidence and the hours
 * from their last record to the cutoff accepted at import. No incident is called resolved or unresolved.
 */
export function RequestsPanel({ workspaceId, preparationId, identity, revision, activities, columns, onOpenCase, openCaseId,
  client = httpRequestsClient, proposalClient = httpProposalClient, store = browserRequests }: RequestsPanelProps) {
  const asked = useId();
  const reading = useMemo(() => ({ workspaceId, preparationId }), [workspaceId, preparationId]);
  const { draft, notice } = useRequests(reading, store);
  const change = (next: (current: RequestsDraft) => RequestsDraft) => store.change(reading, next);
  const columnName = (index: number) => columns.find((item) => item.index === index)?.name ?? `column ${index}`;
  const problem = draftProblem(draft);
  const [read, setRead] = useState<Read<UnansweredRequestsAnswer>>({ phase: "idle" });
  // Asked when the analyst asks for it, and again for other kept incidents while a reviewed definition is shown.
  const [asking, setAsking] = useState<{ draft: RequestsDraft; sequence: number } | null>(null);
  const identityKey = JSON.stringify(identity);
  useEffect(() => {
    if (asking === null || asking.draft !== draft || problem !== null || !draft.reviewed) {
      setRead({ phase: "idle" });
      return;
    }
    const controller = new AbortController();
    setRead({ phase: "loading" });
    client.unanswered({ schema_version: 1, message_type: "unanswered_requests_request", request_id: `requests-${asked}-${revision}-${asking.sequence}`, query_revision: revision,
      workspace_id: workspaceId, identity, definition: definitionOf(draft), case_limit: CASES_LISTED }, controller.signal).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        setRead(outcome.ok ? { phase: "ready", answer: outcome.answer }
          : { phase: "failed", message: outcome.problem.kind === "refusal" ? outcome.problem.refusal.message : "The requests could not be read by the local service." });
      },
      () => !controller.signal.aborted && setRead({ phase: "failed", message: "The requests could not be read by the local service." }),
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking, draft, problem, client, asked, identityKey, revision, workspaceId, preparationId]);

  // The values of the turn column on the records of each activity, from which the request activities can be proposed.
  const [turnColumn, setTurnColumn] = useState<number | null>(draft.turn?.column ?? null);
  const [values, setValues] = useState<Read<StageProposalAnswer>>({ phase: "idle" });
  const valuesRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    setValues({ phase: "idle" });
    return () => valuesRequest.current?.abort();
  }, [turnColumn, identityKey, revision, workspaceId, preparationId, proposalClient]);
  const readValues = () => {
    if (turnColumn === null) return;
    valuesRequest.current?.abort();
    const controller = new AbortController();
    valuesRequest.current = controller;
    setValues({ phase: "loading" });
    proposalClient.propose({ schema_version: 1, message_type: "stage_proposal_request", request_id: `turn-${asked}-${revision}-${turnColumn}`, query_revision: revision,
      workspace_id: workspaceId, identity, column_index: turnColumn, value_limit: 50 }, controller.signal).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        setValues(outcome.ok ? { phase: "ready", answer: outcome.answer } : { phase: "failed", message: outcome.problem.kind === "refusal" ? outcome.problem.refusal.message : "The values could not be read." });
      },
      () => !controller.signal.aborted && setValues({ phase: "failed", message: "The values could not be read." }),
    );
  };
  const observed = values.phase === "ready" ? [...new Set(values.answer.activities.flatMap((item) => item.values.map((value) => value.value)))].sort() : [];
  const proposal = values.phase === "ready" && draft.turn && values.answer.column_index === draft.turn.column
    ? values.answer.activities.flatMap((item) => {
      const held = item.values.find((value) => value.value === draft.turn!.value);
      return held ? [{ activity: item.activity, records: held.record_count, of: item.record_count }] : [];
    })
    : [];
  const toggle = (field: "requests" | "answers", activity: string, on: boolean) =>
    change((current) => ({ ...current, [field]: on ? [...current[field], activity] : current[field].filter((item) => item !== activity) }));
  const answer = read.phase === "ready" ? read.answer : null;
  const reviewId = `${asked}-review`;

  return (
    <section className="view-panel requests-panel" aria-labelledby={`${asked}-title`}>
      <h3 id={`${asked}-title`} className="view-title">Requests without a later answer</h3>
      <p className="muted view-hint">
        You say which activities are requests and which are answers in this log. The incidents whose last request has no later answer in the export are
        listed; none is called resolved or unresolved, and no rate is formed.
      </p>
      {notice?.kind === "restored" && <p className="muted">The definition saved with the investigation “{notice.investigation}”.</p>}
      {notice?.kind === "not_applied" && <p className="limitation" role="note">{notice.message}</p>}
      <fieldset className="requests-activities">
        <legend>Request activities</legend>
        {activities.map((activity) => (
          <label key={activity}><input type="checkbox" checked={draft.requests.includes(activity)} onChange={(event) => toggle("requests", activity, event.target.checked)} /> {activity}</label>
        ))}
      </fieldset>
      <fieldset className="requests-activities">
        <legend>Answer activities</legend>
        {activities.map((activity) => (
          <label key={activity}><input type="checkbox" checked={draft.answers.includes(activity)} onChange={(event) => toggle("answers", activity, event.target.checked)} /> {activity}</label>
        ))}
      </fieldset>
      <fieldset className="requests-turn">
        <legend>Whose turn (optional)</legend>
        <label>
          Turn column
          <select value={turnColumn === null ? "" : String(turnColumn)} onChange={(event) => {
            const column = event.target.value === "" ? null : Number(event.target.value);
            setTurnColumn(column);
            setValues({ phase: "idle" });
            if (column === null) change((current) => ({ ...current, turn: null }));
          }}>
            <option value="">No turn</option>
            {columns.map((column) => <option key={column.index} value={String(column.index)}>{column.name}</option>)}
          </select>
        </label>{" "}
        <button type="button" disabled={turnColumn === null} onClick={readValues}>Read the values of this column</button>
        {values.phase === "loading" && <p className="working-text">Reading the values on every record…</p>}
        {values.phase === "failed" && <p className="inline-error" role="alert">{values.message}</p>}
        {values.phase === "ready" && turnColumn !== null && (
          <label>
            A request counts while the turn is
            <select value={draft.turn?.column === turnColumn ? draft.turn.value : ""} onChange={(event) => change((current) => ({ ...current, turn: event.target.value === "" ? null : { column: turnColumn, value: event.target.value } }))}>
              <option value="">Any value</option>
              {observed.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        )}
        {proposal.length > 0 && (
          <div className="requests-proposal">
            <p>
              Proposed from the observed values: the activities recorded while {columnName(draft.turn!.column)} is “{draft.turn!.value}” —{" "}
              {proposal.map((item) => `“${item.activity}” (${item.records} of ${countOf(item.of, "record")})`).join(", ")}. A proposal is not a definition until you use and review it.
            </p>
            <button type="button" onClick={() => change((current) => ({ ...current, requests: proposal.map((item) => item.activity), answers: current.answers.filter((activity) => !proposal.some((item) => item.activity === activity)) }))}>
              Use the proposal as the request activities
            </button>
          </div>
        )}
      </fieldset>
      <label className="requests-gap">
        A record starts a new matter after a gap of more than (hours, empty for none)
        <input type="text" inputMode="decimal" value={draft.gapHours === null ? "" : String(draft.gapHours)}
          onChange={(event) => {
            const text = event.target.value.trim();
            const value = text === "" ? null : Number(text.replace(",", "."));
            change((current) => ({ ...current, gapHours: value === null || Number.isNaN(value) ? null : value }));
          }} />
      </label>
      {problem !== null ? <p className="muted" role="status">{problem}</p> : (
        <div className="requests-words">
          <p id={reviewId}>{definitionWords(draft, columnName)}</p>
          <label>
            <input type="checkbox" checked={draft.reviewed} aria-describedby={reviewId} onChange={(event) => change((current) => ({ ...current, reviewed: event.target.checked }))} />{" "}
            I have reviewed this definition. It is saved with the investigation once reviewed; any change asks for a new review.
          </label>
        </div>
      )}
      <p>
        <button type="button" className="primary" disabled={problem !== null || !draft.reviewed} onClick={() => setAsking((previous) => ({ draft, sequence: (previous?.sequence ?? 0) + 1 }))}>
          Find the incidents
        </button>
      </p>
      {read.phase === "loading" && <p className="working-text">Reading the last request of every kept incident…</p>}
      {read.phase === "failed" && <p className="inline-error" role="alert">{read.message}</p>}
      {answer && (
        <div className="requests-result">
          <dl className="pairs requests-outcomes" aria-label="Kept incidents by their last request">
            <div><dt>Last request without a later answer</dt><dd>{countOf(answer.outcomes.without_answer, "incident")}</dd></div>
            <div><dt>Last request answered later</dt><dd>{countOf(answer.outcomes.answered, "incident")}</dd></div>
            <div><dt>No request in the latest matter</dt><dd>{countOf(answer.outcomes.no_request, "incident")}</dd></div>
            <div><dt>Order of records not known, not read</dt><dd>{countOf(answer.outcomes.order_unknown, "incident")}</dd></div>
          </dl>
          <p className="limitation">
            Hours since the last record run from an incident's last record to the export cutoff accepted at import, {when(answer.clock.snapshot_cutoff, answer.clock.timestamp_kind)}:
            how long the export holds no further record of the incident. It is not a waiting time, and a later record may exist outside the export.
            {answer.clock.timestamp_kind === "wall_clock" ? " The times are on the clock as recorded, without an offset, so a change of daylight saving time is not taken into account." : ""}
          </p>
          {answer.cases.length > 0 && (
            <table className="requests-table" aria-label="Incidents whose last request has no later answer">
              <thead>
                <tr><th scope="col">Incident</th><th scope="col">Last request</th><th scope="col">Records after it</th><th scope="col">Last record</th><th scope="col">Hours since the last record</th></tr>
              </thead>
              <tbody>
                {answer.cases.map((item) => (
                  <tr key={item.case_id} aria-current={openCaseId === item.case_id || undefined}>
                    <th scope="row">
                      <button type="button" className="link-button" aria-label={`Open ${item.case_id} with its last request marked`} onClick={() => onOpenCase(item.case_id, [item.last_request.row_id])}>
                        {item.case_id}
                      </button>
                    </th>
                    <td>“{item.last_request.activity}”, record {item.last_request.position}, {when(item.last_request.time, answer.clock.timestamp_kind)}</td>
                    <td>{item.records_after_request.toLocaleString("en")}, no answer</td>
                    <td>{when(item.last_record_time, answer.clock.timestamp_kind)}</td>
                    <td>{formatHours(item.hours_since_last_record, "en")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {answer.cases_truncated && <p className="muted">The {CASES_LISTED} incidents longest without a further record are listed; the counts above are of every kept incident.</p>}
        </div>
      )}
    </section>
  );
}
