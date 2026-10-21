import { useId, useState } from "react";
import type { ConfirmMappingRequest, ExcludedSourceRecord, InterpretationAnswer, PreparationId, RowIssue } from "../generated/imports";
import type { EarlierReading } from "./coordinator";
import { oneRecordPerIncident, Understood } from "./Understood";
import { countOf, excludedReasonLabels, issueLabels, severityLabels, utcText, wallText } from "./wording";

/** How many source positions are listed for one reason; the counts above say how many rows there are. */
const POSITIONS_SHOWN = 20;
/** How many excluded records are listed before the analyst asks for all of them. */
const EXCLUDED_SHOWN = 50;

interface ReportProps {
  /** The reading the report answers, exactly as it was sent. */
  request: ConfirmMappingRequest;
  answer: InterpretationAnswer;
  filename?: string;
  /** Whether the analyst entered the cutoff rather than taking the one proposed from the data. */
  cutoffEntered?: boolean;
  /** The reading of the same source with other choices before this one, to show what the change does. */
  previous?: EarlierReading;
  /** Column names by index, as the inspection read them. */
  names: Map<number, string>;
  onAccept: () => void;
  onOpenIncidents: (preparationId: PreparationId) => void;
}

/** The interpretation report exactly as supplied, and what can be done next. */
export function Report({ request, answer, filename, cutoffEntered, previous, names, onAccept, onOpenIncidents }: ReportProps) {
  const { report } = answer;
  const confirmId = useId();
  const singleId = useId();
  const [accepted, setAccepted] = useState(false);
  // A file whose every incident has one record is opened only once the analyst has chosen to read it that way.
  const single = oneRecordPerIncident(answer);
  const [singleAccepted, setSingleAccepted] = useState(false);
  const wall = report.timestamp_kind === "wall_clock";
  const period = (value: string | null) => (value === null ? "none" : wall ? wallText(value) : utcText(value));
  const cutoff = wall ? report.snapshot_cutoff_local : report.snapshot_cutoff_utc;
  // The contract makes the blank and ragged counts optional; a report without them leaves those lines out.
  const supplied = (label: string, count: number | undefined, unit: string): [string, string][] =>
    count === undefined ? [] : [[label, countOf(count, unit)]];
  const figures: [string, string][] = [
    ["Records read", countOf(report.raw_record_count, "record")],
    ...supplied("Blank lines skipped", report.blank_record_count, "blank line"),
    ["With a case id", countOf(report.identified_record_count, "record")],
    ["Outside every case", countOf(report.unassigned_record_count, "record")],
    ...supplied("Of these, with another number of cells than the header", report.ragged_record_count, "record"),
    ["With a usable time", countOf(report.usable_timestamp_record_count, "record")],
    ["Without a usable time: kept, order not known", countOf(report.unavailable_timestamp_record_count, "record")],
    ["Cases", countOf(report.case_count, "case")],
    ["Cases in a known order", countOf(report.sequence_evaluable_case_count, "case")],
    ["Cases in an order not fully known", countOf(report.sequence_unevaluable_case_count, "case")],
    ["Records with an activity label", countOf(report.mapped_activity_record_count, "record")],
    ["Records without activity label", countOf(report.omitted_activity_record_count, "record")],
    ["First usable time", period(wall ? report.first_usable_local_timestamp : report.first_usable_utc_instant)],
    ["Last usable time", period(wall ? report.last_usable_local_timestamp : report.last_usable_utc_instant)],
    ["Export taken at", period(cutoff)],
    [
      "Tied times within a case",
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
      {report.excluded_source_records !== undefined && <Excluded records={report.excluded_source_records} />}
      {report.activities.length > 0 && (
        <details className="report-more">
          <summary>Activities</summary>
          <table className="plain-table compact-table">
            <thead>
              <tr>
                <th scope="col">Activity</th>
                <th scope="col" className="number">Records</th>
                <th scope="col" className="number">Cases</th>
              </tr>
            </thead>
            <tbody>
              {report.activities.map((item) => (
                <tr key={item.activity}>
                  <th scope="row">{item.activity}</th>
                  <td className="number">{countOf(item.record_count, "record")}</td>
                  <td className="number">{countOf(item.case_count, "case")}</td>
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
      {previous !== undefined && <Compared previous={previous} report={report} />}
      {answer.state !== "blocked" && <Understood request={request} answer={answer} names={names} filename={filename} cutoffEntered={cutoffEntered} />}
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
        <div className="confirm">
          {single && (
            <label className="check" htmlFor={singleId}>
              <input id={singleId} type="checkbox" checked={singleAccepted} onChange={(event) => setSingleAccepted(event.target.checked)} />
              Open them as cases of one record each.
            </label>
          )}
          <button
            type="button"
            className="primary"
            data-open-preparation={answer.preparation.preparation_id}
            data-open-place="report"
            disabled={single && !singleAccepted}
            onClick={() => onOpenIncidents(answer.preparation!.preparation_id)}
          >
            Open cases
          </button>
        </div>
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

/** The records outside every incident, each with where it stands in the file and its original text. */
function Excluded({ records }: { records: ExcludedSourceRecord[] }) {
  const [all, setAll] = useState(false);
  if (records.length === 0) return <p className="muted">No record stays outside every case.</p>;
  const shown = all ? records : records.slice(0, EXCLUDED_SHOWN);
  return (
    <div className="excluded">
      <div className="table-scroll" role="region" aria-labelledby="excluded-title" tabIndex={0}>
        <table className="plain-table compact-table excluded-table">
          <caption id="excluded-title" className="caption">
            Records outside every case, as written in the file
          </caption>
          <thead>
            <tr>
              <th scope="col" className="number">Position</th>
              <th scope="col">Lines in the file</th>
              <th scope="col" className="number">Cells</th>
              <th scope="col">Reason</th>
              <th scope="col">Original text</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((record) => (
              <tr key={record.source_position}>
                <td className="number">{record.source_position}</td>
                <td>
                  {record.physical_line_start === record.physical_line_end
                    ? `line ${record.physical_line_start}`
                    : `lines ${record.physical_line_start}–${record.physical_line_end}`}
                </td>
                <td className="number">{record.cell_count}</td>
                <td>{excludedReasonLabels[record.reason]}</td>
                <td>
                  <pre className="original-text">{record.original_text}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {records.length > shown.length && (
        <button type="button" onClick={() => setAll(true)}>
          Show all {countOf(records.length, "record")} outside every case
        </button>
      )}
    </div>
  );
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

/** The support of a reading that a change of choices can move, by label. */
const COMPARED: [string, (report: InterpretationAnswer["report"]) => number, string][] = [
  ["With a usable time", (report) => report.usable_timestamp_record_count, "record"],
  ["Without a usable time", (report) => report.unavailable_timestamp_record_count, "record"],
  ["With a case id", (report) => report.identified_record_count, "record"],
  ["Outside every case", (report) => report.unassigned_record_count, "record"],
  ["Cases", (report) => report.case_count, "case"],
  ["Cases in a known order", (report) => report.sequence_evaluable_case_count, "case"],
  ["Records without activity label", (report) => report.omitted_activity_record_count, "record"],
  ["Records sharing a time within a case", (report) => report.tied_timestamp_record_count, "record"],
];

/** What a change of choices does to the support, beside the previous reading of the same source, which stays as it was. */
function Compared({ previous, report }: { previous: EarlierReading; report: InterpretationAnswer["report"] }) {
  const signed = (value: number) => (value === 0 ? "no change" : `${value > 0 ? "+" : "−"}${Math.abs(value).toLocaleString("en")}`);
  return (
    <div className="compared">
      <table className="plain-table compact-table">
        <caption className="caption">Compared with the previous reading of this source</caption>
        <thead>
          <tr>
            <th scope="col">Support</th>
            <th scope="col" className="number">Previous reading</th>
            <th scope="col" className="number">This reading</th>
            <th scope="col" className="number">Change</th>
          </tr>
        </thead>
        <tbody>
          {COMPARED.map(([label, of, unit]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td className="number">{countOf(of(previous.report), unit)}</td>
              <td className="number">{countOf(of(report), unit)}</td>
              <td className="number">{signed(of(report) - of(previous.report))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        The previous reading stays as it was{previous.preparationId !== null ? `, as preparation ${previous.preparationId}` : ""}, with everything saved on
        it; this reading becomes a preparation of its own once it is ready.
      </p>
    </div>
  );
}
