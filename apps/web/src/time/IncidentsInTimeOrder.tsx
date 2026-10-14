import { useEffect, useId, useMemo, useState } from "react";
import { countOf } from "../data/wording";
import type { CaseListAnswer, CaseListRequest, ExplorerCaseSummary } from "../generated/case-list";
import type { CaseId, ImportedCaseSummary } from "../generated/imports";
import type { AnswerIdentity } from "../generated/selection";
import { answersCaseList, type CaseListClient, httpCaseListClient } from "../filters/client";
import { type FocusRequest, IncidentWindow, type IncidentTimes } from "../imported/IncidentWindow";
import { durationName } from "./periods";
import "./time.css";

/** The two orders by time the local service sorts the incidents in, the longest first. */
export type TimeOrder = "observed_span_hours" | "maximum_adjacent_raw_gap_hours";

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
}

type Listed = { phase: "loading" } | { phase: "ready"; rows: ExplorerCaseSummary[]; answer: CaseListAnswer; more: boolean } | { phase: "failed"; message: string };

const timesOf = (row: ExplorerCaseSummary): IncidentTimes =>
  row.time_summary.status === "available"
    ? { span: row.time_summary.observed_span_hours, gap: row.time_summary.maximum_adjacent_raw_gap_hours }
    : { span: null, gap: null };

/**
 * The kept incidents in the order the local service sorts them by recorded span or by longest gap,
 * the longest first, a page at a time, with both times as columns. An incident without the time
 * stands where the service puts it, with a dash.
 */
export function IncidentsInTimeOrder({ workspaceId, revision, identity, kept, order, caseLists = httpCaseListClient, ...table }: IncidentsInTimeOrderProps) {
  const asked = useId();
  const [listed, setListed] = useState<Listed>({ phase: "loading" });
  const [offset, setOffset] = useState(0);
  const identityKey = JSON.stringify(identity);

  // Another order, another selection or another revision starts the list again from its first page.
  useEffect(() => setOffset(0), [order, identityKey, revision]);

  useEffect(() => {
    const controller = new AbortController();
    const request: CaseListRequest = {
      schema_version: 1, message_type: "case_list_request", request_id: `order-${asked}-${revision}-${offset}`, query_revision: revision,
      workspace_id: workspaceId, identity, query: { search_text: null, sort: { field: order, direction: "descending" }, offset, limit: PAGE },
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
  }, [caseLists, workspaceId, revision, identityKey, order, offset, asked]);

  const keptById = useMemo(() => new Map(kept.map((summary) => [summary.case_id, summary])), [kept]);
  const rows = listed.phase === "ready" ? listed.rows : [];
  const cases = useMemo(() => rows.flatMap((row) => keptById.get(row.case_id) ?? []), [rows, keptById]);
  const times = useMemo(() => new Map(rows.map((row) => [row.case_id, timesOf(row)])), [rows]);

  if (listed.phase === "loading") return <p className="working-text">Ordering the kept incidents…</p>;
  if (listed.phase === "failed") return <p className="inline-error" role="alert">The incidents could not be ordered by time: {listed.message}</p>;
  const total = listed.answer.total_matching_case_count;
  return (
    <>
      <IncidentWindow cases={cases} times={times} duration={durationName} {...table} />
      <div className="incident-more">
        <span className="muted">
          {countOf(cases.length, "incident")} of {total.toLocaleString("en")}
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
