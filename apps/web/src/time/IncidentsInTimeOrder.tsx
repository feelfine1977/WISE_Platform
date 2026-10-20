import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
import { countOf } from "../data/wording";
import type { CaseListAnswer, CaseListRequest, ExplorerCaseSummary } from "../generated/case-list";
import type { CaseId, ImportedCaseSummary } from "../generated/imports";
import type { AnswerIdentity } from "../generated/selection";
import { answersCaseList, type CaseListClient, httpCaseListClient } from "../filters/client";
import { type ExtraColumn, type FocusRequest, IncidentWindow, type IncidentTimes } from "../imported/IncidentWindow";
import { type ImportClient, httpImportClient } from "../data/client";
import { firstRecordCell, gapBetween } from "./gapWording";
import { IncidentInFocus } from "./IncidentInFocus";
import { durationName } from "./periods";
import { MarksLoader, RecordMarks } from "./RecordMarks";
import "./time.css";

/** The orders the local service sorts the kept incidents in: by recorded span, by longest gap, by record count or by first record. */
export type TimeOrder = "observed_span_hours" | "maximum_adjacent_raw_gap_hours" | "record_count" | "first_recorded_time";
type Direction = "ascending" | "descending";

/** Each order's first direction, and how each direction is said. */
const ORDERS: Record<TimeOrder, { first: Direction; measure: string; said: Record<Direction, string> }> = {
  observed_span_hours: { first: "descending", measure: "recorded span", said: { descending: "the longest first", ascending: "the shortest first" } },
  maximum_adjacent_raw_gap_hours: { first: "descending", measure: "longest gap between two records", said: { descending: "the longest first", ascending: "the shortest first" } },
  record_count: { first: "descending", measure: "number of records", said: { descending: "the most first", ascending: "the fewest first" } },
  first_recorded_time: { first: "ascending", measure: "time of the first record", said: { ascending: "the earliest first", descending: "the latest first" } },
};

/** How many incidents one page of the ordered list holds; the service gives at most this many at once. */
export const PAGE = 200;

interface IncidentsInTimeOrderProps {
  workspaceId: string;
  revision: number;
  /** The identity of the kept incidents. */
  identity: AnswerIdentity;
  /** The kept incidents as the table shows them; the service says only their order and their times. */
  kept: readonly ImportedCaseSummary[];
  order: TimeOrder;
  openCaseId: CaseId | null;
  onOpen: (caseId: CaseId) => void;
  focusRequest: FocusRequest | null;
  labelledBy: string;
  describedBy?: string;
  waitingFor?: string;
  caseLists?: CaseListClient;
  /** Where the evidence of an incident in view is read from, for the marks of its records. */
  evidence?: Pick<ImportClient, "caseEvidence">;
  /** Opens an incident with some of its records marked: the two records of its longest gap. */
  onShowRecords?: (caseId: CaseId, rowIds: string[]) => void;
  /** Asks for another order from a column head; a click on the head of the current order reverses it here. */
  onOrder?: (order: TimeOrder) => void;
}

type Listed = { phase: "loading" } | { phase: "ready"; rows: ExplorerCaseSummary[]; answer: CaseListAnswer; more: boolean } | { phase: "failed"; message: string };

const timesOf = (row: ExplorerCaseSummary): IncidentTimes =>
  row.time_summary.status === "available"
    ? { span: row.time_summary.observed_span_hours, gap: row.time_summary.maximum_adjacent_raw_gap_hours }
    : { span: null, gap: null };

/**
 * The kept incidents in the order the local service sorts them, by recorded span, by longest gap, by
 * record count or by first record, either way round, a page at a time, with both times, the first
 * record and the two activities of the longest gap as columns. Equal values stand in the order of
 * their numbers, and an incident without the value stands last either way, with a dash. A search by
 * incident number narrows only the rows shown; the counts and the distribution stay those of all
 * kept incidents. What the list says of the incident in the current row stands under it.
 */
export function IncidentsInTimeOrder({ workspaceId, revision, identity, kept, order, caseLists = httpCaseListClient, evidence = httpImportClient, onShowRecords, onOrder, ...table }: IncidentsInTimeOrderProps) {
  const asked = useId();
  const searchId = useId();
  const [listed, setListed] = useState<Listed>({ phase: "loading" });
  const [offset, setOffset] = useState(0);
  // A failed page is asked again on request; the order and the kept incidents stay as they are.
  const [attempt, setAttempt] = useState(0);
  const [direction, setDirection] = useState<Direction>(ORDERS[order].first);
  // The search as typed, and as last asked: only "Find" asks the service again.
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState<string | null>(null);
  const [activeCase, setActiveCase] = useState<CaseId | null>(null);
  const identityKey = JSON.stringify(identity);

  // Another order starts at its own first direction.
  useEffect(() => setDirection(ORDERS[order].first), [order]);
  // Another order, direction, search, selection or revision starts the list again from its first page.
  useEffect(() => setOffset(0), [order, direction, search, identityKey, revision]);

  useEffect(() => {
    const controller = new AbortController();
    const request: CaseListRequest = {
      schema_version: 1, message_type: "case_list_request", request_id: `order-${asked}-${revision}-${offset}-${attempt}`, query_revision: revision,
      workspace_id: workspaceId, identity, query: { search_text: search, sort: { field: order, direction }, offset, limit: PAGE },
    };
    if (offset === 0) setListed({ phase: "loading" });
    caseLists.list(request, controller.signal).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        if (!outcome.ok || !answersCaseList(request, outcome.answer)) {
          setListed({ phase: "failed", message: !outcome.ok && outcome.problem.kind === "refusal" ? outcome.problem.refusal.message : "The order could not be read from the local service." });
          return;
        }
        const answer = outcome.answer;
        setListed((current) => ({
          phase: "ready",
          rows: offset > 0 && current.phase === "ready" ? [...current.rows, ...answer.rows] : answer.rows,
          answer,
          more: answer.next_offset !== null,
        }));
      },
      () => !controller.signal.aborted && setListed({ phase: "failed", message: "The order could not be read from the local service." }),
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseLists, workspaceId, revision, identityKey, order, direction, search, offset, asked, attempt]);

  const keptById = useMemo(() => new Map(kept.map((summary) => [summary.case_id, summary])), [kept]);
  const rows = listed.phase === "ready" ? listed.rows : [];
  const cases = useMemo(() => rows.flatMap((row) => keptById.get(row.case_id) ?? []), [rows, keptById]);
  const times = useMemo(() => new Map(rows.map((row) => [row.case_id, timesOf(row)])), [rows]);
  // The marks of the records of each incident in view, on one axis as long as the longest span listed, aligned at the first record.
  const loader = useMemo(() => new MarksLoader(evidence, { workspaceId, revision, identity }), [evidence, workspaceId, revision, identityKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const axisHours = useMemo(() => Math.max(0, ...rows.map((row) => timesOf(row).span ?? 0)), [rows]);
  const byId = useMemo(() => new Map(rows.map((row) => [row.case_id, row])), [rows]);
  const extras: ExtraColumn[] = useMemo(() => {
    const timeOf = (caseId: CaseId) => {
      const time = byId.get(caseId)?.time_summary;
      return time?.status === "available" ? time : null;
    };
    const witnessOf = (caseId: CaseId) => timeOf(caseId)?.maximum_gap_witness ?? null;
    const dash = <span className="muted" title="Not available for this incident">–</span>;
    return [
      { head: "First record", sort: "first_recorded_time", cell: (caseId) => { const row = byId.get(caseId); const first = row ? firstRecordCell(row) : null; return first ?? dash; } },
      { head: "Longest gap between", cell: (caseId) => { const witness = witnessOf(caseId); return witness ? <span title={gapBetween(witness)}>{gapBetween(witness)}</span> : dash; } },
      {
        head: `Records over time, 0 to ${durationName(axisHours)}`,
        cell: (caseId) => {
          const witness = witnessOf(caseId);
          const gap = timeOf(caseId)?.maximum_adjacent_raw_gap_hours ?? null;
          return <RecordMarks caseId={caseId} loader={loader} axisHours={axisHours} gap={witness && gap !== null ? { fromHours: witness.from_offset_hours, hours: gap } : null} />;
        },
      },
    ];
  }, [byId, loader, axisHours]);
  const focused = (activeCase !== null ? byId.get(activeCase) : undefined) ?? rows[0];

  function find(event: FormEvent) {
    event.preventDefault();
    setSearch(typed.trim() === "" ? null : typed.trim());
  }

  const said = ORDERS[order];
  const tools = (
    <div className="incident-search-line">
      <p className="muted incident-order-said">
        By {said.measure}, {said.said[direction]}; equal values in the order of their numbers, and incidents without a value last.
      </p>
      <button type="button" aria-pressed={direction !== said.first} onClick={() => setDirection(direction === "ascending" ? "descending" : "ascending")}>
        Reverse
      </button>
      <form className="incident-search" role="search" aria-label="Find incidents by number" onSubmit={find}>
        <label htmlFor={searchId}>Incident number contains</label>
        <input id={searchId} type="search" value={typed} onChange={(event) => setTyped(event.target.value)} />
        <button type="submit">Find</button>
        {search !== null && (
          <button type="button" onClick={() => { setTyped(""); setSearch(null); }}>
            Show every kept incident
          </button>
        )}
      </form>
    </div>
  );

  if (listed.phase === "loading") return <>{tools}<p className="working-text">Ordering the kept incidents…</p></>;
  if (listed.phase === "failed") {
    return (
      <>
      {tools}
      <div className="inline-error" role="alert">
        <p>The incidents could not be ordered by time: {listed.message}</p>
        <button
          type="button"
          onClick={() => {
            // The list is read again from its first page, so that no page of it is missing.
            setOffset(0);
            setAttempt((count) => count + 1);
          }}
        >
          Ask again
        </button>
      </div>
      </>
    );
  }
  const total = listed.answer.total_matching_case_count;
  const population = listed.answer.population_case_count;
  return (
    <>
      {tools}
      {search !== null && (
        <p className="incident-search-said" role="status">
          {total === 0
            ? `No kept incident has “${search}” in its number.`
            : `${countOf(total, "kept incident")} of ${population.toLocaleString("en")} ${total === 1 ? "has" : "have"} “${search}” in ${total === 1 ? "its number" : "their numbers"}.`}{" "}
          The search narrows only the rows shown: the kept incidents, their counts and their distribution stay the same.
        </p>
      )}
      <IncidentWindow cases={cases} times={times} duration={durationName} extras={extras} onActive={setActiveCase} {...table}
        sorting={{
          column: order, descending: direction === "descending",
          // The head of the current order reverses it; another head orders by its column, in that column's first direction.
          onSort: (column) => (column === order ? setDirection(direction === "ascending" ? "descending" : "ascending") : onOrder?.(column)),
        }} />
      {focused !== undefined && <IncidentInFocus row={focused} columns={listed.answer.context_columns} onShowRecords={onShowRecords} />}
      {rows.some((row) => "timestamp_kind" in row.time_summary && row.time_summary.timestamp_kind === "wall_clock") && (
        <p className="muted">
          Wall clock: span and longest gap are differences between times as recorded, without a time zone; across a clock change they may differ
          from the physical elapsed time.
        </p>
      )}
      <div className="incident-more">
        <span className="muted">
          {countOf(cases.length, "incident")} of {total.toLocaleString("en")}{search !== null ? ` found` : ""}
        </span>
        {listed.more && (
          <button type="button" onClick={() => setOffset(listed.answer.next_offset ?? offset)}>
            Show {Math.min(PAGE, total - cases.length).toLocaleString("en")} more
          </button>
        )}
      </div>
    </>
  );
}
