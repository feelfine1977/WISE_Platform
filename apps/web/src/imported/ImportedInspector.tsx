import { useMemo, useRef, useState, type RefObject } from "react";
import type { AnswerIdentity, Column, ImportedCaseEvidenceAnswer, ImportedCaseSummary, ImportedSourceRecord } from "../generated/imports";
import type { DocumentClient } from "../documents/client";
import { DocumentPane, referenceOf } from "../documents/DocumentPane";
import type { InspectorLayout } from "../components/Inspector";
import { ImportProblemNotice } from "../data/ImportProblemNotice";
import { countOf, utcText, wallText } from "../data/wording";
import { GapSince, IncidentTimeline } from "../timeline/IncidentTimeline";
import { suppliedTimeline, type Gap } from "../timeline/timeline";
import type { ImportedCaseState } from "./coordinator";

interface ImportedInspectorProps {
  inspected: Exclude<ImportedCaseState, { phase: "closed" }>;
  summary: ImportedCaseSummary | undefined;
  layout: InspectorLayout;
  onLayout: (layout: InspectorLayout) => void;
  onReturn: () => void;
  onRetry: () => void;
  /** The id of the text saying why trying again has to wait, while it has to. */
  waitingFor?: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  highlightedRowIds?: readonly string[];
  /** Where the records' documents are read: present only when the preparation declares a document reference column. */
  documents?: RecordDocuments;
}

export interface RecordDocuments {
  workspaceId: string;
  identity: AnswerIdentity;
  column: number;
  client?: DocumentClient;
}

/** Every record of one imported incident in the declared order, as a vertical sequence. */
export function ImportedInspector({ inspected, summary, layout, onLayout, onReturn, onRetry, waitingFor, headingRef, highlightedRowIds, documents }: ImportedInspectorProps) {
  const collapsed = layout === "collapsed";
  return (
    <section className="imported-inspector" aria-labelledby="imported-inspector-title">
      <div className="inspector-head">
        <div>
          <h2 id="imported-inspector-title" tabIndex={-1} ref={headingRef}>
            Incident <span className="identifier">{inspected.caseId}</span>
          </h2>
          <p className="muted">
            {summary && <>{countOf(summary.record_count, "record")} · </>}
            Complete history in the declared order. Escape returns to the incidents.
          </p>
        </div>
        <div className="inspector-actions">
          <button type="button" aria-expanded={!collapsed} aria-controls="imported-inspector-body" onClick={() => onLayout(collapsed ? "side" : "collapsed")}>
            {collapsed ? "Expand" : "Collapse"}
          </button>
          {!collapsed && (
            <button type="button" className="wide-only" aria-pressed={layout === "full"} onClick={() => onLayout(layout === "full" ? "side" : "full")}>
              Full width
            </button>
          )}
          <button type="button" className="primary" onClick={onReturn}>
            Return to incidents
          </button>
        </div>
      </div>
      <div id="imported-inspector-body" hidden={collapsed}>
        {inspected.phase === "loading" && (
          <p role="status" className="working-text">
            Loading every record of {inspected.caseId}…
          </p>
        )}
        {inspected.phase === "failed" && (
          <ImportProblemNotice title={`The records of ${inspected.caseId} could not be shown`} problem={inspected.problem} onRetry={onRetry} waitingFor={waitingFor} />
        )}
        {inspected.phase === "ready" && <History answer={inspected.answer} highlightedRowIds={highlightedRowIds} documents={documents} />}
      </div>
    </section>
  );
}

/** The records in the declared order, and above them their elapsed time: the strip of the recorded times and the longest gap. */
function History({ answer, highlightedRowIds = [], documents }: { answer: ImportedCaseEvidenceAnswer; highlightedRowIds?: readonly string[]; documents?: RecordDocuments }) {
  const { coverage } = answer;
  const omitted = new Set(answer.omitted_activity_row_ids);
  const names = new Map(answer.columns.map((column) => [column.index, column.name]));
  // The elapsed times are the local service's, bound to the records place by place; where it supplied none, none are computed here.
  const timeline = useMemo(() => suppliedTimeline(answer.records, answer.incident_time), [answer]);
  const list = useRef<HTMLOListElement>(null);
  /** A mark of the strip and the longest gap lead to a record of the list: the focus moves to it, which brings it into view. */
  const showRecord = (place: number) => {
    const entry = list.current?.children[place];
    if (entry instanceof HTMLElement) entry.focus();
  };
  // The record whose document is open beside the timeline; closing it returns the focus to that record.
  const [documentPlace, setDocumentPlace] = useState<number | null>(null);
  const documentPlaces = useMemo(() => new Set(documents ? answer.records.flatMap((record, place) => referenceOf(record, documents.column) ? [place] : []) : []),
    [answer, documents]);
  const closeDocument = () => {
    const place = documentPlace;
    setDocumentPlace(null);
    if (place !== null) requestAnimationFrame(() => showRecord(place));
  };
  return (
    <>
      <p className="coverage">
        <strong>{countOf(coverage.raw_record_count, "record")}</strong> of this incident · {countOf(coverage.mapped_record_count, "record")} in the
        activity sequence · {countOf(coverage.omitted_activity_record_count, "record")} without an activity label
      </p>
      {!answer.sequence_evaluable && (
        <p className="order-note">
          The order of this incident is not fully known: records without a usable time follow the timed records in source order, which is
          not their recorded order.
        </p>
      )}
      <div className={documentPlace !== null ? "history-layout with-document" : "history-layout"}>
      <div>
      <IncidentTimeline caseId={answer.case_id} records={answer.records} timeline={timeline} onShowRecord={showRecord}
        documentPlaces={documents ? documentPlaces : undefined} onOpenDocument={documents ? setDocumentPlace : undefined} />
      <ol className="history" ref={list} aria-label={`Records of incident ${answer.case_id} in the declared order`}>
        {answer.records.map((record, place) => (
          <HistoryEntry
            key={record.row_id}
            record={record}
            omitted={omitted.has(record.row_id)}
            columns={answer.columns}
            names={names}
            gap={timeline.gaps[place]}
            longest={timeline.longest?.to === place}
            highlighted={highlightedRowIds.includes(record.row_id)}
            onOpenDocument={documentPlaces.has(place) ? () => setDocumentPlace(place) : undefined}
          />
        ))}
      </ol>
      </div>
      {documents && documentPlace !== null && (
        <DocumentPane workspaceId={documents.workspaceId} identity={documents.identity} caseId={answer.case_id} records={answer.records}
          documentColumn={documents.column} place={documentPlace} onPlace={setDocumentPlace} onClose={closeDocument} client={documents.client} />
      )}
      </div>
    </>
  );
}

interface HistoryEntryProps {
  record: ImportedSourceRecord;
  omitted: boolean;
  columns: Column[];
  names: Map<number, string>;
  /** The gap since the record before; none while the gaps of the incident are not computed. */
  gap: Gap | undefined;
  /** Whether that gap is the longest of the incident. */
  longest: boolean;
  highlighted: boolean;
  /** Opens the record's document beside the timeline; absent when the record names no document. */
  onOpenDocument?: () => void;
}

function HistoryEntry({ record, omitted, columns, names, gap, longest, highlighted, onOpenDocument }: HistoryEntryProps) {
  return (
    <li className={omitted ? "history-entry no-label" : "history-entry"} data-contributing={highlighted || undefined} tabIndex={-1}>
      <span className="history-marker" aria-hidden="true" />
      <div className="history-body">
        {highlighted && <p className="flag">Contributing source record · {record.row_id}</p>}
        <p className="history-activity">{record.activity === null ? <span className="missing-text">no activity label</span> : record.activity}</p>
        <p className="history-meta">
          <TimeText record={record} /> · source position {record.source_position}
          {record.source_sequence !== null && <> · sequence {record.source_sequence}</>}
        </p>
        <GapSince gap={gap} longest={longest} />
        {onOpenDocument && <button type="button" className="link-button" onClick={onOpenDocument}>Open document</button>}
        {record.context.length > 0 && (
          <dl className="history-context">
            {record.context.map((value) => (
              <div key={value.column_index}>
                <dt>{names.get(value.column_index) ?? `Column ${value.column_index}`}</dt>
                <dd>{value.value === null ? <span className="missing-text">missing</span> : value.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <details className="history-cells">
          <summary>Original cells</summary>
          <dl className="pairs">
            {columns.map((column) => {
              const cell = record.original_cells[column.index];
              return (
                <div key={column.index}>
                  <dt>{column.name === "" ? `Column ${column.index}` : column.name}</dt>
                  <dd>{cell === "" ? <span className="missing-text">missing</span> : cell}</dd>
                </div>
              );
            })}
          </dl>
        </details>
      </div>
    </li>
  );
}

function TimeText({ record }: { record: ImportedSourceRecord }) {
  if (record.timestamp_status === "missing") return <span className="flag">no time</span>;
  if (record.timestamp_status === "invalid") return <span className="flag">time not readable</span>;
  if (record.utc_instant !== null) return <>{utcText(record.utc_instant)}</>;
  if (record.local_timestamp !== null) return <>{wallText(record.local_timestamp)}</>;
  return <span className="flag">no time</span>;
}
