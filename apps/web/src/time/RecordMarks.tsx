import { useEffect, useState } from "react";
import type { ImportClient } from "../data/client";
import type { AnswerIdentity, CaseId, ImportedCaseEvidenceAnswer } from "../generated/imports";
import { durationName } from "./periods";

const HOUR = 3_600_000_000;

/** The supplied offsets of the records of one incident from its first record, or why there are none. */
export type IncidentMarks =
  | { kind: "known"; offsets: number[] }
  | { kind: "order_unknown"; records: number }
  | { kind: "not_supplied" }
  | { kind: "failed" };

/** What an incident's evidence says of where its records lie in time, read from the diagnostics the local service supplies with it. */
export function marksOf(answer: ImportedCaseEvidenceAnswer): IncidentMarks {
  const time = answer.incident_time;
  if (time === undefined) return { kind: "not_supplied" };
  if (time.observed_span_microseconds === null) return { kind: "order_unknown", records: answer.records.length };
  const rows: readonly { offset_from_first_record_microseconds: string | null }[] = time.records;
  // Exact offsets become numbers here only to be placed on the axis.
  return { kind: "known", offsets: rows.map((row) => Number(BigInt(row.offset_from_first_record_microseconds ?? "0"))) };
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
    const loading = this.client
      .caseEvidence(
        {
          schema_version: 1,
          message_type: "imported_case_evidence_request",
          request_id: `marks-${this.ask.revision}-${caseId}`,
          query_revision: this.ask.revision,
          workspace_id: this.ask.workspaceId,
          identity: this.ask.identity,
          case_id: caseId,
        },
        controller.signal,
      )
      .then(
        (outcome): IncidentMarks => (outcome.ok && outcome.answer.case_id === caseId ? marksOf(outcome.answer) : { kind: "failed" }),
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
    const said = marks.kind === "order_unknown" ? "order not known" : marks.kind === "not_supplied" ? "times not supplied" : "not read";
    return <span className="muted record-marks-none">{said}</span>;
  }
  const width = axisHours > 0 ? axisHours * HOUR : 1;
  const last = marks.offsets[marks.offsets.length - 1] ?? 0;
  return (
    <span className="record-marks" role="img" aria-label={`${marks.offsets.length} records over ${durationName(last / HOUR)}, from the first record`}>
      <svg viewBox="0 0 1000 12" preserveAspectRatio="none" aria-hidden="true">
        <line className="record-marks-span" x1={0} x2={Math.min(1000, (last / width) * 1000)} y1={6} y2={6} vectorEffect="non-scaling-stroke" />
        {marks.offsets.map((offset, place) => (
          <line key={place} className="record-marks-mark" x1={Math.min(1000, (offset / width) * 1000)} x2={Math.min(1000, (offset / width) * 1000)} y1={1} y2={11} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </span>
  );
}
