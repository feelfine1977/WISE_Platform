import type { ReactNode, RefObject } from "react";
import type { CaseEvidenceAnswer, CaseSummary, InputPolicies, SourceRecord } from "../generated/investigation";
import type { InspectedCaseState } from "../investigation/coordinator";
import { countOf, partitionLabel, utcInstant } from "../investigation/wording";
import { ProblemNotice } from "./ProblemNotice";
import { Missing, Value } from "./Values";

export type InspectorLayout = "side" | "full" | "collapsed";

interface InspectorProps {
  inspected: Exclude<InspectedCaseState, { phase: "closed" }>;
  /** The incident's row in the population answer, when the answer lists it. */
  summary: CaseSummary | undefined;
  policies: InputPolicies;
  layout: InspectorLayout;
  onLayout: (layout: InspectorLayout) => void;
  onReturn: () => void;
  onRetry: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}

/** The complete history of one incident: every record in the declared order. */
export function Inspector({ inspected, summary, policies, layout, onLayout, onReturn, onRetry, headingRef }: InspectorProps) {
  const collapsed = layout === "collapsed";
  return (
    <section className="inspector" aria-labelledby="inspector-title">
      <div className="inspector-head">
        <div className="inspector-heading">
          <h2 id="inspector-title" tabIndex={-1} ref={headingRef}>
            Incident <span className="identifier truncated" title={inspected.caseId}>{inspected.caseId}</span>
          </h2>
          <p className="inspector-note">
            {summary && <>{partitionLabel(summary.partition, policies)} · </>}
            Complete history in the declared order. Escape returns to the incidents.
          </p>
        </div>
        <div className="inspector-actions">
          <button type="button" aria-expanded={!collapsed} aria-controls="inspector-body" onClick={() => onLayout(collapsed ? "side" : "collapsed")}>
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
      <div id="inspector-body" className="inspector-body" hidden={collapsed}>
        {inspected.phase === "loading" && (
          <p role="status" className="pane-note">
            Loading every record of {inspected.caseId}…
          </p>
        )}
        {inspected.phase === "failed" && (
          <ProblemNotice title={`The records of ${inspected.caseId} could not be shown`} problem={inspected.problem} onRetry={onRetry} />
        )}
        {inspected.phase === "ready" && <Records answer={inspected.answer} />}
      </div>
    </section>
  );
}

function Records({ answer }: { answer: CaseEvidenceAnswer }) {
  const { coverage } = answer;
  const mapped = new Set(answer.mapped_row_ids);
  const omitted = new Set(answer.omitted_activity_row_ids);
  return (
    <>
      <p className="coverage">
        <strong>{countOf(coverage.raw_record_count, "record")}</strong> of this incident ·{" "}
        {countOf(coverage.mapped_record_count, "record")} in the mapped sequence ·{" "}
        {countOf(coverage.omitted_activity_record_count, "record")} left out: no activity
      </p>
      <ol className="sequence" aria-label={`Every record of incident ${answer.case_id} in the declared order`}>
        {answer.records.map((record) => {
          const membership = mapped.has(record.row_id)
            ? "Included"
            : omitted.has(record.row_id)
              ? "Left out: no activity"
              : "Not stated";
          return (
            <li key={record.row_id} className={omitted.has(record.row_id) ? "record left-out" : "record"}>
              <p className="record-activity" title={record.activity ?? undefined}>
                {record.activity === null ? (
                  <span className="no-label">no activity label</span>
                ) : (
                  <Value interpreted={record.activity} written={record.original_values.activity} />
                )}
              </p>
              <RecordValues record={record} membership={membership} />
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** When and where the record was written; every value of it, as interpreted and as written, on demand. */
function RecordValues({ record, membership }: { record: SourceRecord; membership: string }) {
  const written = record.original_values;
  const rows: [string, ReactNode][] = [
    ["Source position", record.source_position],
    ["Event", <Value interpreted={record.source_event_id} written={written.source_event_id} />],
    ["Sequence", <Value interpreted={record.source_sequence} written={written.source_sequence} />],
    ["Timestamp (UTC)", <Value interpreted={record.timestamp_utc} written={written.timestamp_utc} />],
    ["Activity", <Value interpreted={record.activity} written={written.activity} />],
    ["Service", <Value interpreted={record.service} written={written.service} />],
    ["Assignment group", <Value interpreted={record.assignment_group} written={written.assignment_group} />],
    ["Mapped sequence", membership],
    ["Record identity", <code>{record.row_id}</code>],
  ];
  return (
    <details className="record-values">
      <summary className="record-meta">
        {record.timestamp_utc === null ? <Missing written={written.timestamp_utc} /> : utcInstant(record.timestamp_utc)}
        {" · "}source position {record.source_position} · {membership}
        <span className="values-cue"> · values</span>
      </summary>
      <dl className="value-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
