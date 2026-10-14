import { useEffect, useState } from "react";
import { sameJson } from "../data/coordinator";
import type { ImportClient } from "../data/client";
import type { AnswerIdentity, CaseId, ImportedCaseEvidenceAnswer } from "../generated/imports";
import { durationName } from "./periods";

const HOUR = 3_600_000_000;

/** The supplied offsets of the records of one incident from its first record, or why there are none. */
export type IncidentMarks =
  /** The offsets in the declared order, and the places of the two records the supplied longest gap lies between, where there is one. */
  | { kind: "known"; offsets: number[]; longest: [number, number] | null }
  | { kind: "order_unknown"; records: number }
  | { kind: "not_supplied" }
  /** The diagnostics do not belong to the records place by place, so nothing is placed. */
  | { kind: "mismatch" }
  | { kind: "failed" };

/** What an incident's evidence says of where its records lie in time, read from the diagnostics the local service supplies with it. */
export function marksOf(answer: ImportedCaseEvidenceAnswer): IncidentMarks {
  const time = answer.incident_time;
  if (time === undefined) return { kind: "not_supplied" };
  const rows: readonly { row_id: string; offset_from_first_record_microseconds: string | null }[] = time.records;
  // The diagnostics belong to the records place by place, as on the timeline of the incident; otherwise nothing is placed.
  if (rows.length !== answer.records.length || rows.some((row, place) => row.row_id !== answer.records[place].row_id)) return { kind: "mismatch" };
  if (time.observed_span_microseconds === null) return { kind: "order_unknown", records: answer.records.length };
  const witness = time.summary.maximum_gap_witness;
  const from = witness ? rows.findIndex((row) => row.row_id === witness.from_row_id) : -1;
  const to = witness ? rows.findIndex((row) => row.row_id === witness.to_row_id) : -1;
  // Exact offsets become numbers here only to be placed on the axis.
  return {
    kind: "known",
    offsets: rows.map((row) => Number(BigInt(row.offset_from_first_record_microseconds ?? "0"))),
    longest: from >= 0 && to >= 0 ? [from, to] : null,
  };
}

/**
 * Loads the marks of the incidents of one list, each once, from the evidence of the incident as the
 * local service supplies it. Only the incidents in view ask; what was loaded is kept for the list.
 */
export class MarksLoader {
  private readonly loaded = new Map<CaseId, Promise<IncidentMarks>>();

  constructor(
    private readonly client: Pick<ImportClient, "caseEvidence">,
    private readonly ask: { workspaceId: string; revision: number; identity: AnswerIdentity },
  ) {}

  marks(caseId: CaseId): Promise<IncidentMarks> {
    const known = this.loaded.get(caseId);
    if (known) return known;
    const controller = new AbortController();
    const request = {
      schema_version: 1 as const,
      message_type: "imported_case_evidence_request" as const,
      request_id: `marks-${this.ask.revision}-${caseId}`,
      query_revision: this.ask.revision,
      workspace_id: this.ask.workspaceId,
      identity: this.ask.identity,
      case_id: caseId,
    };
    // Only an answer to exactly this question is drawn: the same request, revision, workspace, incident and whole identity.
    const answers = (answer: ImportedCaseEvidenceAnswer) =>
      answer.request_id === request.request_id &&
      answer.query_revision === request.query_revision &&
      answer.workspace_id === request.workspace_id &&
      answer.case_id === request.case_id &&
      sameJson(answer.identity, request.identity);
    const loading = this.client.caseEvidence(request, controller.signal).then(
      (outcome): IncidentMarks => (outcome.ok && answers(outcome.answer) ? marksOf(outcome.answer) : { kind: "failed" }),
      (): IncidentMarks => ({ kind: "failed" }),
    );
    this.loaded.set(caseId, loading);
    return loading;
  }
}

interface RecordMarksProps {
  caseId: CaseId;
  loader: MarksLoader;
  /** The length of the common axis in hours: the longest recorded span among the incidents listed. */
  axisHours: number;
}

/** The records of one incident as marks on the common axis of its list, the first record at the left. */
export function RecordMarks({ caseId, loader, axisHours }: RecordMarksProps) {
  const [marks, setMarks] = useState<IncidentMarks | null>(null);
  useEffect(() => {
    let current = true;
    void loader.marks(caseId).then((loaded) => current && setMarks(loaded));
    return () => {
      current = false;
    };
  }, [caseId, loader]);
  if (marks === null) return <span className="record-marks-loading" aria-label="Reading the times of the records" />;
  if (marks.kind !== "known") {
    const said =
      marks.kind === "order_unknown" ? "order not known" : marks.kind === "not_supplied" ? "times not supplied" : marks.kind === "mismatch" ? "times do not match" : "not read";
    return <span className="muted record-marks-none">{said}</span>;
  }
  const width = axisHours > 0 ? axisHours * HOUR : 1;
  const last = marks.offsets[marks.offsets.length - 1] ?? 0;
  return (
    <span className="record-marks" role="img" aria-label={`${marks.offsets.length} records over ${durationName(last / HOUR)}, from the first record`}>
      <svg viewBox="0 0 1000 12" preserveAspectRatio="none" aria-hidden="true">
        <line className="record-marks-span" x1={0} x2={Math.min(1000, (last / width) * 1000)} y1={6} y2={6} vectorEffect="non-scaling-stroke" />
        {marks.longest !== null && (
          // The supplied longest gap, between its two records, as the timeline of the incident marks it.
          <line
            className="record-marks-longest"
            x1={Math.min(1000, (marks.offsets[marks.longest[0]] / width) * 1000)}
            x2={Math.min(1000, (marks.offsets[marks.longest[1]] / width) * 1000)}
            y1={6}
            y2={6}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {marks.offsets.map((offset, place) => (
          <line key={place} className="record-marks-mark" x1={Math.min(1000, (offset / width) * 1000)} x2={Math.min(1000, (offset / width) * 1000)} y1={1} y2={11} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </span>
  );
}
