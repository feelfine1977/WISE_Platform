import { useEffect, useState } from "react";
import type { AnswerIdentity, CaseId } from "../generated/imports";
import type { IncidentMarks as SuppliedMarks } from "../generated/record-marks";
import { httpMarksClient, type MarksClient } from "./marksClient";
import { durationName } from "./periods";

const HOUR = 3_600_000_000;
/** How many incidents one request of marks asks for: the bound of the local service's batch projection. */
export const MARKS_BATCH = 100;

/** The supplied marks of one incident, or that they could not be read. */
export type IncidentMarks = { kind: "known"; supplied: SuppliedMarks } | { kind: "failed" };

/**
 * Loads the marks of the incidents of one list in bounded batches: the incidents in view that ask in the same moment are
 * asked for together, at most MARKS_BATCH at once, and each is asked once for the list.
 */
export class MarksLoader {
  private readonly loaded = new Map<CaseId, Promise<IncidentMarks>>();
  private waiting: { caseId: CaseId; settle: (marks: IncidentMarks) => void }[] = [];
  private batches = 0;

  constructor(
    private readonly client: MarksClient,
    private readonly ask: { workspaceId: string; revision: number; identity: AnswerIdentity },
    /** Told the longest span of each batch, in hours, so that the common axis is as long as the longest row drawn. */
    private readonly onSpan?: (hours: number) => void,
  ) {}

  marks(caseId: CaseId): Promise<IncidentMarks> {
    const known = this.loaded.get(caseId);
    if (known) return known;
    const loading = new Promise<IncidentMarks>((settle) => {
      this.waiting.push({ caseId, settle });
      if (this.waiting.length === 1) queueMicrotask(() => this.flush());
    });
    this.loaded.set(caseId, loading);
    return loading;
  }

  private flush(): void {
    const waiting = this.waiting;
    this.waiting = [];
    for (let start = 0; start < waiting.length; start += MARKS_BATCH) {
      const batch = waiting.slice(start, start + MARKS_BATCH);
      this.batches += 1;
      const failed = () => batch.forEach((item) => item.settle({ kind: "failed" }));
      this.client.marks({
        schema_version: 1, message_type: "record_marks_request", request_id: `marks-${this.ask.revision}-${this.batches}`, query_revision: this.ask.revision,
        workspace_id: this.ask.workspaceId, identity: this.ask.identity, case_ids: batch.map((item) => item.caseId),
      }, new AbortController().signal).then((outcome) => {
        if (!outcome.ok) return failed();
        const byId = new Map(outcome.answer.cases.map((item) => [item.case_id, item]));
        this.onSpan?.(Math.max(0, ...outcome.answer.cases.map((item) => (item.span_microseconds ?? 0) / HOUR)));
        for (const item of batch) {
          const supplied = byId.get(item.caseId);
          item.settle(supplied ? { kind: "known", supplied } : { kind: "failed" });
        }
      }, failed);
    }
  }
}

interface RecordMarksProps {
  caseId: CaseId;
  loader: MarksLoader;
  /** The length of the common axis in hours: the longest recorded span among the incidents listed. */
  axisHours: number;
  /** The longest gap of the incident as the list supplies it: where it begins after the first record, and how long it is. */
  gap?: { fromHours: number; hours: number } | null;
}

/** A place on the axis as a share of its length, in per cent, as SVG writes a coordinate. */
const percent = (share: number) => `${Math.min(100, Math.max(0, share * 100)).toFixed(3)}%`;

/**
 * The records of one incident as marks on the common axis of its list, the first record at the left. Records at the same
 * time are one mark with their count written beside it; records without a usable time are counted in a lane of their own,
 * after the axis. Every record is a mark or counted there: nothing is left out.
 */
export function RecordMarks({ caseId, loader, axisHours, gap = null }: RecordMarksProps) {
  const [marks, setMarks] = useState<IncidentMarks | null>(null);
  useEffect(() => {
    let current = true;
    void loader.marks(caseId).then((loaded) => current && setMarks(loaded));
    return () => {
      current = false;
    };
  }, [caseId, loader]);
  if (marks === null) return <span className="record-marks-loading" aria-label="Reading the times of the records" />;
  if (marks.kind === "failed") return <span className="muted record-marks-none">not read</span>;
  const { supplied } = marks;
  const width = axisHours > 0 ? axisHours * HOUR : 1;
  const place = (microseconds: number) => percent(microseconds / width);
  const last = supplied.span_microseconds ?? 0;
  const band = gap !== null && gap.hours > 0 ? { from: (gap.fromHours * HOUR) / width, to: ((gap.fromHours + gap.hours) * HOUR) / width } : null;
  const timed = supplied.marks.reduce((sum, mark) => sum + mark.record_count, 0);
  const tied = supplied.marks.filter((mark) => mark.record_count > 1);
  const parts = [
    timed === 0 ? `${supplied.record_count} records, none with a usable time` : `${timed} of ${supplied.record_count} records over ${durationName(last / HOUR)}, from the first record`,
    ...tied.map((mark) => (mark.offset_microseconds === 0 ? `${mark.record_count} at the time of the first record` : `${mark.record_count} together, ${durationName(mark.offset_microseconds / HOUR)} after it`)),
    ...(supplied.untimed_record_count > 0 ? [`${supplied.untimed_record_count} without a usable time`] : []),
  ];
  const said = timed === supplied.record_count && tied.length === 0 ? `${supplied.record_count} records over ${durationName(last / HOUR)}, from the first record` : parts.join("; ");
  return (
    <span className="record-marks" role="img"
      aria-label={band !== null && gap !== null ? `${said}; the longest gap, ${durationName(gap.hours)}, marked from ${durationName(gap.fromHours)}` : said}>
      <svg aria-hidden="true">
        {band !== null && <rect className="record-marks-gap" x={percent(band.from)} width={percent(Math.max(0, band.to - band.from))} y={6} height={6} />}
        {timed > 0 && <line className="record-marks-span" x1="0%" x2={place(last)} y1={9} y2={9} />}
        {supplied.marks.map((mark) => (
          <line key={mark.offset_microseconds} className={mark.record_count > 1 ? "record-marks-mark record-marks-tie" : "record-marks-mark"}
            x1={place(mark.offset_microseconds)} x2={place(mark.offset_microseconds)} y1={3} y2={15} />
        ))}
        {tied.map((mark) => (
          <text key={`count-${mark.offset_microseconds}`} className="record-marks-count" x={place(mark.offset_microseconds)} dx={3} y={13}>{mark.record_count}</text>
        ))}
      </svg>
      {supplied.untimed_record_count > 0 && <span className="record-marks-untimed">+{supplied.untimed_record_count} without a time</span>}
    </span>
  );
}

export { httpMarksClient };
export type { MarksClient };
