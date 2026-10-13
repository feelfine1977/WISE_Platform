import type { RefObject } from "react";
import type { Column, ImportedCaseEvidenceAnswer, ImportedCaseSummary, ImportedSourceRecord } from "../generated/imports";
import type { InspectorLayout } from "../components/Inspector";
import { ImportProblemNotice } from "../data/ImportProblemNotice";
import { countOf, utcText, wallText } from "../data/wording";
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
}

/** Every record of one imported incident in the declared order, as a vertical sequence. */
export function ImportedInspector({ inspected, summary, layout, onLayout, onReturn, onRetry, waitingFor, headingRef }: ImportedInspectorProps) {
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
        {inspected.phase === "ready" && <History answer={inspected.answer} />}
      </div>
    </section>
  );
}

function History({ answer }: { answer: ImportedCaseEvidenceAnswer }) {
  const { coverage } = answer;
  const omitted = new Set(answer.omitted_activity_row_ids);
  const names = new Map(answer.columns.map((column) => [column.index, column.name]));
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
      <ol className="history" aria-label={`Records of incident ${answer.case_id} in the declared order`}>
        {answer.records.map((record) => (
          <HistoryEntry key={record.row_id} record={record} omitted={omitted.has(record.row_id)} columns={answer.columns} names={names} />
        ))}
      </ol>
    </>
  );
}

interface HistoryEntryProps {
  record: ImportedSourceRecord;
  omitted: boolean;
  columns: Column[];
  names: Map<number, string>;
}

function HistoryEntry({ record, omitted, columns, names }: HistoryEntryProps) {
  return (
    <li className={omitted ? "history-entry no-label" : "history-entry"}>
      <span className="history-marker" aria-hidden="true" />
      <div className="history-body">
        <p className="history-activity">{record.activity === null ? <span className="missing-text">no activity label</span> : record.activity}</p>
        <p className="history-meta">
          <TimeText record={record} /> · source position {record.source_position}
          {record.source_sequence !== null && <> · sequence {record.source_sequence}</>}
        </p>
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
