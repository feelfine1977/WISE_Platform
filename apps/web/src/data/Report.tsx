import { useId, useState } from "react";
import type { InterpretationAnswer, PreparationId, RowIssue } from "../generated/imports";
import { countOf, issueLabels, severityLabels, utcText, wallText } from "./wording";

/** How many source positions are listed for one reason; the counts above say how many rows there are. */
const POSITIONS_SHOWN = 20;

interface ReportProps {
  answer: InterpretationAnswer;
  /** Column names by index, as the inspection read them. */
  names: Map<number, string>;
  onAccept: () => void;
  onOpenIncidents: (preparationId: PreparationId) => void;
}

/** The interpretation report exactly as supplied, and what can be done next. */
export function Report({ answer, names, onAccept, onOpenIncidents }: ReportProps) {
  const { report } = answer;
  const confirmId = useId();
  const [accepted, setAccepted] = useState(false);
  const wall = report.timestamp_kind === "wall_clock";
  const period = (value: string | null) => (value === null ? "none" : wall ? wallText(value) : utcText(value));
  const cutoff = wall ? report.snapshot_cutoff_local : report.snapshot_cutoff_utc;
  const figures: [string, string][] = [
    ["Records read", countOf(report.raw_record_count, "record")],
    ["With an incident id", countOf(report.identified_record_count, "record")],
    ["Without incident id: outside every incident", countOf(report.unassigned_record_count, "record")],
    ["With a usable time", countOf(report.usable_timestamp_record_count, "record")],
    ["Without a usable time: kept, order not known", countOf(report.unavailable_timestamp_record_count, "record")],
    ["Incidents", countOf(report.case_count, "incident")],
    ["Incidents in a known order", countOf(report.sequence_evaluable_case_count, "incident")],
    ["Incidents in an order not fully known", countOf(report.sequence_unevaluable_case_count, "incident")],
    ["Records with an activity label", countOf(report.mapped_activity_record_count, "record")],
    ["Records without activity label", countOf(report.omitted_activity_record_count, "record")],
    ["First usable time", period(wall ? report.first_usable_local_timestamp : report.first_usable_utc_instant)],
    ["Last usable time", period(wall ? report.last_usable_local_timestamp : report.last_usable_utc_instant)],
    ["Export taken at", period(cutoff)],
    [
      "Tied times within an incident",
      `${countOf(report.tied_timestamp_groups, "group")} of ${countOf(report.tied_timestamp_record_count, "record")}`,
    ],
    ["Rows repeating an earlier row", countOf(report.duplicate_candidate_record_count, "record")],
  ];
  return (
    <div className="report">
      <StateLine answer={answer} />
      <dl className="report-figures">
        {figures.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {report.missing_cells.length > 0 && (
        <table className="plain-table compact-table">
          <caption className="caption">Empty cells in the columns with a role, over all records read</caption>
          <thead>
            <tr>
              <th scope="col">Column</th>
              <th scope="col" className="number">Records with an empty cell</th>
            </tr>
          </thead>
          <tbody>
            {report.missing_cells.map((item) => (
              <tr key={item.column_index}>
                <th scope="row">{names.get(item.column_index) || `Column ${item.column_index}`}</th>
                <td className="number">{countOf(item.record_count, "record")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Issues issues={report.issues} />
      {report.activities.length > 0 && (
        <details className="report-more">
          <summary>Activities</summary>
          <table className="plain-table compact-table">
            <thead>
              <tr>
                <th scope="col">Activity</th>
                <th scope="col" className="number">Records</th>
                <th scope="col" className="number">Incidents</th>
              </tr>
            </thead>
            <tbody>
              {report.activities.map((item) => (
                <tr key={item.activity}>
                  <th scope="row">{item.activity}</th>
                  <td className="number">{countOf(item.record_count, "record")}</td>
                  <td className="number">{countOf(item.case_count, "incident")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {report.assumptions.length > 0 && (
        <details className="report-more">
          <summary>How the records were read</summary>
          <ul>
            {report.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </details>
      )}
      {answer.state === "needs_confirmation" && (
        <div className="confirm">
          <label className="check" htmlFor={confirmId}>
            <input id={confirmId} type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
            I have read the rows with issues; keep them as described above.
          </label>
          <button type="button" className="primary" disabled={!accepted} onClick={onAccept}>
            Confirm and prepare
          </button>
        </div>
      )}
      {answer.state === "ready" && answer.preparation !== null && (
        <button type="button" className="primary" onClick={() => onOpenIncidents(answer.preparation!.preparation_id)}>
          Open incidents
        </button>
      )}
    </div>
  );
}

function StateLine({ answer }: { answer: InterpretationAnswer }) {
  switch (answer.state) {
    case "ready":
      return (
        <p className="state-line state-ready" role="status">
          Ready: the source is read with these choices and kept in the workspace.
        </p>
      );
    case "needs_confirmation":
      return (
        <p className="state-line state-confirm" role="status">
          Some rows have issues. They are kept as described below; confirm them to prepare the source.
        </p>
      );
    case "blocked":
      return (
        <p className="state-line state-blocked" role="status">
          The source cannot be prepared with these choices: some rows block the reading. Change the choices above, or correct the export.
        </p>
      );
  }
}

/** The supplied row issues, by reason, with the source positions of the first rows of each. */
function Issues({ issues }: { issues: RowIssue[] }) {
  if (issues.length === 0) return <p className="muted">No row has an issue.</p>;
  const byReason = new Map<RowIssue["code"], RowIssue[]>();
  for (const issue of issues) {
    const listed = byReason.get(issue.code);
    if (listed) listed.push(issue);
    else byReason.set(issue.code, [issue]);
  }
  return (
    <div className="issues">
      <h4 className="label-text">Rows with issues, by reason</h4>
      <ul>
        {[...byReason].map(([code, listed]) => {
          const shown = listed.slice(0, POSITIONS_SHOWN).map((issue) => (issue.source_position === null ? "whole source" : String(issue.source_position)));
          return (
            <li key={code} className={`issue issue-${listed[0].severity}`}>
              <span className="issue-reason">{issueLabels[code]}</span>
              <span className="issue-severity">{severityLabels[listed[0].severity]}</span>
              <span className="issue-positions">
                Source position{shown.length === 1 ? "" : "s"} {shown.join(", ")}
                {listed.length > POSITIONS_SHOWN ? ` and further rows (the first ${POSITIONS_SHOWN} are listed)` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
