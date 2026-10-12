import type { RefObject } from "react";
import type { CaseEvidenceAnswer, CaseSummary, InputPolicies } from "../generated/investigation";
import type { InspectedCaseState } from "../investigation/coordinator";
import { countOf, partitionLabel } from "../investigation/wording";
import { ProblemNotice } from "./ProblemNotice";
import { Value } from "./Values";

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
        <div>
          <h2 id="inspector-title" tabIndex={-1} ref={headingRef}>
            Incident {inspected.caseId}
          </h2>
          <p className="muted">
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
      <div id="inspector-body" hidden={collapsed}>
        {inspected.phase === "loading" && (
          <p role="status" className="pending">
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
      <div className="table-scroll" role="region" aria-labelledby="inspector-title" tabIndex={0}>
        <table className="record-table">
          <caption className="visually-hidden">Every record of incident {answer.case_id} in the declared order</caption>
          <thead>
            <tr>
              <th scope="col" className="number">Order</th>
              <th scope="col" className="number">Source position</th>
              <th scope="col">Event</th>
              <th scope="col" className="number">Sequence</th>
              <th scope="col">Timestamp (UTC)</th>
              <th scope="col">Activity</th>
              <th scope="col">Service</th>
              <th scope="col">Assignment group</th>
              <th scope="col">Mapped sequence</th>
            </tr>
          </thead>
          <tbody>
            {answer.records.map((record, index) => {
              const written = record.original_values;
              const membership = mapped.has(record.row_id)
                ? "Included"
                : omitted.has(record.row_id)
                  ? "Left out: no activity"
                  : "Not stated";
              return (
                <tr key={record.row_id} className={omitted.has(record.row_id) ? "left-out" : undefined}>
                  <td className="number">{index + 1}</td>
                  <td className="number">{record.source_position}</td>
                  <th scope="row">
                    <Value interpreted={record.source_event_id} written={written.source_event_id} />
                  </th>
                  <td className="number">
                    <Value interpreted={record.source_sequence} written={written.source_sequence} />
                  </td>
                  <td>
                    <Value interpreted={record.timestamp_utc} written={written.timestamp_utc} />
                  </td>
                  <td>
                    <Value interpreted={record.activity} written={written.activity} />
                  </td>
                  <td>
                    <Value interpreted={record.service} written={written.service} />
                  </td>
                  <td>
                    <Value interpreted={record.assignment_group} written={written.assignment_group} />
                  </td>
                  <td>{membership}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details className="row-identities">
        <summary>Record identities</summary>
        <dl className="pairs">
          {answer.records.map((record) => (
            <div key={record.row_id}>
              <dt>Source position {record.source_position}</dt>
              <dd><code>{record.row_id}</code></dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  );
}
