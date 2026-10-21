import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
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
  /** When the export the incident was read from was taken, on the preparation's clock. */
  observation?: Observation;
  /** The selection the incident was opened from, which reading it does not change. */
  selection?: { kept: number; parent: number; steps: number; removed?: number };
  /** What the analyst can do with the history read: pin it, for example. */
  actions?: ReactNode;
}

export interface Observation {
  timestamp_kind: "utc_instant" | "wall_clock";
  /** The snapshot cutoff of the preparation, as its policy declares it. */
  cutoff: string;
}

export interface RecordDocuments {
  workspaceId: string;
  identity: AnswerIdentity;
  column: number;
  client?: DocumentClient;
}

/** Every record of one imported incident in the declared order, as a vertical sequence. */
export function ImportedInspector({ inspected, summary, layout, onLayout, onReturn, onRetry, waitingFor, headingRef, highlightedRowIds, documents, observation, selection, actions }: ImportedInspectorProps) {
  const collapsed = layout === "collapsed";
  return (
    <section className="imported-inspector" aria-labelledby="imported-inspector-title">
      <div className="inspector-head">
        <div>
          <h2 id="imported-inspector-title" tabIndex={-1} ref={headingRef}>
            Case <span className="identifier">{inspected.caseId}</span>
          </h2>
          <p className="muted">
            {summary && <>{countOf(summary.record_count, "record")} · </>}
            Complete history in the declared order. Escape returns to the cases.
          </p>
          {inspected.side === "pinned" ? (
            <p className="muted focus-line">You are reading a pinned history in the population it was pinned in; reading it changes no step.</p>
          ) : (
            selection && <p className="muted focus-line">{focusLine(selection, inspected.side === "removed")}</p>
          )}
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
            Return to cases
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
        {inspected.phase === "ready" && inspected.refusal && (
          <ImportProblemNotice title={`The pinned history of ${inspected.refusal.caseId} could not be read; the history below is the one read before`}
            problem={inspected.refusal.problem} />
        )}
        {inspected.phase === "ready" && actions}
        {inspected.phase === "ready" && <History answer={inspected.answer} highlightedRowIds={highlightedRowIds} documents={documents} observation={observation} />}
      </div>
    </section>
  );
}

/** The records in the declared order, and above them their elapsed time: the strip of the recorded times and the longest gap. */
function History({ answer, highlightedRowIds = [], documents, observation }: { answer: ImportedCaseEvidenceAnswer; highlightedRowIds?: readonly string[]; documents?: RecordDocuments; observation?: Observation }) {
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
        <strong>{countOf(coverage.raw_record_count, "record")}</strong> of this case · {countOf(coverage.mapped_record_count, "record")} in the
        activity sequence · {countOf(coverage.omitted_activity_record_count, "record")} without an activity label
      </p>
      <p className="order-rule">{orderRule(answer.records)}</p>
      {observation && <p className="observation-line">{observationLine(answer.records, observation)}</p>}
      {!answer.sequence_evaluable && (
        <p className="order-note">
          The order of this case is not fully known: records without a usable time follow the timed records in source order, which is
          not their recorded order.
        </p>
      )}
      <div className={documentPlace !== null ? "history-layout with-document" : "history-layout"}>
      <div>
      <IncidentTimeline caseId={answer.case_id} records={answer.records} timeline={timeline} onShowRecord={showRecord}
        documentPlaces={documents ? documentPlaces : undefined} onOpenDocument={documents ? setDocumentPlace : undefined} />
      <ol className="history" ref={list} aria-label={`Records of case ${answer.case_id} in the declared order`}>
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

/**
 * The declared order of an incident's records in words: the registered order policy reads the usable time first, then a
 * mapped sequence number, then the position in the file; records without a usable time follow in file order.
 */
export function orderRule(records: readonly ImportedSourceRecord[]): string {
  const sequenced = records.some((record) => record.source_sequence !== null);
  return sequenced
    ? "Records are in the declared order: by their usable time; records with the same time by their sequence number, then by their place in the file. Where a sequence number disagrees with the times, the time decides."
    : "Records are in the declared order: by their usable time; records with the same time by their place in the file.";
}

/**
 * How long the incident was observed after its last usable record: the export's cutoff, on the preparation's clock, and
 * the time from the last usable time to it. A later record could still have come; the cutoff is not a completion.
 */
export function observationLine(records: readonly ImportedSourceRecord[], observation: Observation): string {
  const wall = observation.timestamp_kind === "wall_clock";
  const times = records.flatMap((record) => {
    const value = wall ? record.local_timestamp : record.utc_instant;
    return record.timestamp_status === "usable" && value ? [value] : [];
  });
  const cutoff = wall ? `${observation.cutoff.replace("T", " ")}, as recorded` : observation.cutoff.replace("T", " ").replace("Z", " UTC");
  if (times.length === 0) return `The export was taken at ${cutoff}; no record of this case has a usable time, so how long it was observed is not known.`;
  const parse = (value: string) => Date.parse(wall ? `${value}Z` : value);
  const last = Math.max(...times.map(parse));
  const hours = (parse(observation.cutoff) - last) / 3_600_000;
  const age = hours >= 48 ? `${Math.floor(hours / 24).toLocaleString("en")} days` : `${Math.round(hours * 10) / 10} hours`;
  return `The export was taken at ${cutoff}, ${age} after the last usable time of this case; records after the export are not in it, so this is no sign that the case was complete.`;
}

/** The incident read beside the selection it comes from: reading one incident changes no step and no membership. */
export function focusLine({ kept, parent, steps, removed = 0 }: { kept: number; parent: number; steps: number; removed?: number }, fromRemoved = false): string {
  if (fromRemoved)
    return `You are reading one case of the ${countOf(removed, "case")} the selection removes, in its parent of ${countOf(parent, "case")} (${countOf(steps, "step")}); reading it changes no step.`;
  return steps === 0
    ? `You are reading one case of all ${countOf(parent, "case")}; no step is taken, and reading it takes none.`
    : `You are reading one case of the ${countOf(kept, "case")} the selection keeps of ${countOf(parent, "case")} (${countOf(steps, "step")}); reading it changes no step.`;
}
