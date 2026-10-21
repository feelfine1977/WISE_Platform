import { useEffect, useId, useRef } from "react";
import type { ConfirmMappingRequest, InterpretationAnswer } from "../generated/imports";
import { formatLabels, offsetLabel } from "./interpretation";
import { countOf, delimiterName, encodingName, utcText, wallText } from "./wording";

interface UnderstoodProps {
  request: ConfirmMappingRequest;
  answer: InterpretationAnswer;
  /** Column names by index, as the inspection read them. */
  names: Map<number, string>;
  filename: string | undefined;
  /** Whether the analyst entered the cutoff; otherwise it is the one proposed from the data. */
  cutoffEntered?: boolean;
}

/** The roles of a reading's policies, in the order the summary lists their versions. */
const POLICY_ROLES: [keyof ConfirmMappingRequest["policies"], string][] = [
  ["time", "Time policy"],
  ["order", "Order policy"],
  ["missing_values", "Empty-cell policy"],
  ["identifier", "Incident id policy"],
  ["activity_projection", "Activity label policy"],
  ["parent", "Parent policy"],
  ["rows", "Row policy"],
];

/** The empty-cell reading the fixed missing-value policy applies; the screen offers no other. */
export const EMPTY_CELLS =
  "An empty cell is read as missing: in the incident id (where a cell of spaces only counts as empty), the activity, the time and each context column. " +
  "Anything written in a cell, such as 0, False or Unknown, is kept exactly as written and is never read as missing; a missing value is never shown as 0, False or Unknown.";

/** Whether every incident has exactly one record: the shape of a list of incidents rather than of their histories. */
export function oneRecordPerIncident(answer: InterpretationAnswer): boolean {
  const { report } = answer;
  return report.case_count > 1 && report.case_count === report.identified_record_count;
}

function column(names: Map<number, string>, index: number): string {
  return `“${names.get(index) || `Column ${index}`}”`;
}

function zoneOf(request: ConfirmMappingRequest): string {
  const time = request.policies.time;
  if (time.id === "incident.time.wall_clock_as_recorded.v1") return "as recorded: no zone is applied";
  const zone = time.parameters.timezone;
  return zone.mode === "fixed_offset" ? `one fixed offset for every time, ${offsetLabel(zone.offset_minutes)}` : "with the offset written in each value";
}

/**
 * What WISE understood of the source before its incidents are opened: how the records reconcile, which column has which
 * role, how the times and empty cells are read, and the identities of the source and its preparation. Every figure is the
 * service's own report; every choice is the one the request sent.
 */
export function Understood({ request, answer, names, filename, cutoffEntered = false }: UnderstoodProps) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { report } = answer;
  const { mapping, dialect } = request;
  const time = request.policies.time;
  const wall = time.id === "incident.time.wall_clock_as_recorded.v1";
  const cutoff = wall ? report.snapshot_cutoff_local : report.snapshot_cutoff_utc;
  // Each new report moves the focus here, so that a keyboard or screen reader user learns what the reading gave.
  useEffect(() => heading.current?.focus(), [answer.request_id]);
  const roles: [string, string][] = [
    ["Incident id", column(names, mapping.case_column)],
    ["Activity", column(names, mapping.activity_column)],
    ["Time", `${column(names, mapping.timestamp_column)}, read as ${formatLabels[time.parameters.format]}, ${zoneOf(request)}`],
    ["Sequence number", mapping.sequence_column == null ? "none: equal times keep the order of the file" : column(names, mapping.sequence_column)],
    ["Context attributes", mapping.context_columns.length === 0 ? "none" : mapping.context_columns.map((index) => column(names, index)).join(", ")],
    ...(mapping.document_reference_column == null ? [] : [["Document reference", column(names, mapping.document_reference_column)] as [string, string]]),
    [
      "Order",
      `by the usable time; records with the same time by ${mapping.sequence_column == null ? "their place in the file" : "the sequence number, then their place in the file"}` +
        `${mapping.sequence_column == null ? "" : "; where a sequence number disagrees with the times, the time decides"}` +
        "; records without a usable time follow in file order, and their incident's order is then not fully known",
    ],
    [
      "Clock",
      wall
        ? "wall clock as recorded, without a time zone: a duration is a difference of recorded times and may differ from the physical elapsed time"
        : "instants in UTC: a duration is elapsed time",
    ],
    ["Written as", `${encodingName(dialect.encoding)}; ${delimiterName(dialect.delimiter)} as the delimiter; the first record as the header`],
    [
      "Export taken at",
      cutoff == null
        ? "none"
        : `${wall ? `${wallText(cutoff)}, as recorded` : utcText(cutoff)}; ${cutoffEntered ? "entered by you" : "proposed from the latest usable time"}`,
    ],
  ];
  return (
    <section className="understood" aria-labelledby={titleId}>
      <h4 id={titleId} ref={heading} tabIndex={-1} className="label-text-strong">
        What WISE understood
      </h4>
      <p>
        {countOf(report.raw_record_count, "record")} read{filename ? ` from ${filename}` : ""}: {countOf(report.identified_record_count, "record")} in{" "}
        {countOf(report.case_count, "incident")}, and {countOf(report.unassigned_record_count, "record")} outside every incident. Each row is read as one
        recorded event or change of its incident. The records outside every incident stay in the report below with their original text; no incident is
        made of them.
      </p>
      {report.raw_record_count > 0 && report.usable_timestamp_record_count === 0 && (
        <p className="state-line state-confirm" role="note">
          No record has a usable time with these choices, so the order of no incident is known: there will be no paths, no variants and no durations,
          though every record is kept. The count beside each time format above says how many values it reads; choose one that reads them.
        </p>
      )}
      {oneRecordPerIncident(answer) && (
        <p className="state-line state-confirm" role="note">
          Every incident has exactly one record. A file with one row per incident lists incidents rather than their histories: its incidents have no
          order, no time between events and no path. If this file lists incidents, export their event history instead.
        </p>
      )}
      <dl className="report-figures understood-roles">
        {roles.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">{EMPTY_CELLS}</p>
      <details className="report-more">
        <summary>Policies of this reading, with their versions</summary>
        <dl className="report-figures">
          {POLICY_ROLES.map(([role, label]) => (
            <div key={role}>
              <dt>{label}</dt>
              <dd className="identifier">{request.policies[role].id}</dd>
            </div>
          ))}
        </dl>
      </details>
      <dl className="report-figures">
        <div>
          <dt>Source</dt>
          <dd className="identifier">{request.source_id}</dd>
        </div>
        <div>
          <dt>Preparation</dt>
          <dd className="identifier">
            {answer.preparation !== null ? answer.preparation.preparation_id : "given once the rows with issues are confirmed"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
