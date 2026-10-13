import { useRef, useState, type KeyboardEvent } from "react";
import type { CaseId, ImportedSourceRecord } from "../generated/imports";
import { countOf } from "../data/wording";
import type { Gap, LongestGap, Strip, Timeline } from "./timeline";
import { basisLine, elapsedText, gapLine, longestGapWords, markLabel, noAxisLine, STRIP_HINT, timeText, untimedLine, withheldLine } from "./wording";
import "./timeline.css";

interface IncidentTimelineProps {
  caseId: CaseId;
  /** Every record of the incident in the declared order, as the list below shows them. */
  records: readonly ImportedSourceRecord[];
  timeline: Timeline;
  /** Moves the focus to the record at this place of the list. */
  onShowRecord: (place: number) => void;
}

/** The elapsed time of one incident above its history: the strip of its recorded times, its longest gap, and what the numbers rest on. */
export function IncidentTimeline({ caseId, records, timeline, onShowRecord }: IncidentTimelineProps) {
  const { strip, longest, withheld } = timeline;
  const computed = strip.kind === "axis" || timeline.gaps.some((gap) => gap.kind === "elapsed" || gap.kind === "earlier");
  return (
    <section className="timeline" aria-label={`Elapsed time of incident ${caseId}`}>
      {strip.kind === "axis" ? (
        <TimeStrip caseId={caseId} records={records} strip={strip} longest={longest} onShowRecord={onShowRecord} />
      ) : (
        <p>{noAxisLine(strip, records.length, strip.kind === "one_time" ? timeText(records[strip.mark.records[0]]) : "")}</p>
      )}
      {strip.kind === "axis" && timeline.untimedCount > 0 && <p>{untimedLine(timeline.untimedCount)}</p>}
      {longest && <Longest longest={longest} records={records} onShowRecord={onShowRecord} />}
      {/* One record has no record before it, so there is no gap to withhold. */}
      {withheld && records.length > 1 && <p className="timeline-note">{withheldLine(withheld)}</p>}
      {computed && <p className="timeline-note">{basisLine(timeline.clock)}</p>}
    </section>
  );
}

/** Where the axis and the counts above the marks lie in the height of the drawing. */
const AXIS = "62%";
const COUNTS = "26%";

/** A position on the strip as a share of the width of the drawing. */
function across(position: number): string {
  return `${Math.round(position * 100_000) / 1000}%`;
}

interface TimeStripProps {
  caseId: CaseId;
  records: readonly ImportedSourceRecord[];
  strip: Extract<Strip, { kind: "axis" }>;
  longest: LongestGap | null;
  onShowRecord: (place: number) => void;
}

/**
 * The recorded times on a linear axis from the earliest to the latest: one mark per distinct time.
 * Only one mark is a tab stop, so Tab passes the strip; the arrow keys, Home and End move between the marks.
 */
function TimeStrip({ caseId, records, strip, longest, onShowRecord }: TimeStripProps) {
  const { marks } = strip;
  const last = marks.length - 1;
  const [stop, setStop] = useState(0);
  const controls = useRef(new Map<number, SVGGElement>()).current;
  const labels = marks.map((mark) => markLabel(timeText(records[mark.records[0]]), mark.records.length, mark.time - marks[0].time));
  const positionOf = (place: number) => marks.find((mark) => mark.records.includes(place))?.position ?? 0;

  const moves: Record<string, (place: number) => number> = {
    ArrowRight: (place) => Math.min(place + 1, last),
    ArrowLeft: (place) => Math.max(place - 1, 0),
    Home: () => 0,
    End: () => last,
  };

  function onKeyDown(event: KeyboardEvent<SVGGElement>, place: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onShowRecord(marks[place].records[0]);
      return;
    }
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    controls.get(move(place))?.focus();
  }

  return (
    <>
      <p className="timeline-elapsed">
        Elapsed from the earliest to the latest recorded time: <strong>{elapsedText(strip.microseconds)}</strong> · {countOf(marks.length, "distinct time")}
      </p>
      <div className="timeline-frame">
        <svg
          className="timeline-strip"
          role="group"
          aria-label={`Recorded times of incident ${caseId}, the earliest at the left and the latest at the right`}
          aria-describedby="timeline-hint"
        >
          <line className="timeline-axis" x1="0" x2="100%" y1={AXIS} y2={AXIS} />
          {longest && <line className="timeline-longest-span" x1={across(positionOf(longest.from))} x2={across(positionOf(longest.to))} y1={AXIS} y2={AXIS} />}
          {/* The hit areas lie under every mark, so a mark that is seen is the one the pointer reaches. */}
          {marks.map((mark) => (
            <circle key={mark.time} className="timeline-hit" cx={across(mark.position)} cy={AXIS} onClick={() => onShowRecord(mark.records[0])} />
          ))}
          {marks.map((mark, place) => (
            <g
              key={mark.time}
              className={mark.records.length > 1 ? "timeline-mark several" : "timeline-mark"}
              role="button"
              aria-label={labels[place]}
              tabIndex={place === Math.min(stop, last) ? 0 : -1}
              ref={(element) => {
                if (element) controls.set(place, element);
                else controls.delete(place);
              }}
              onFocus={() => setStop(place)}
              onKeyDown={(event) => onKeyDown(event, place)}
              onClick={() => onShowRecord(mark.records[0])}
            >
              <title>{labels[place]}</title>
              <circle className="timeline-ring" cx={across(mark.position)} cy={AXIS} />
              <circle className="timeline-dot" cx={across(mark.position)} cy={AXIS} />
              {mark.records.length > 1 && (
                <text className="timeline-count" x={across(mark.position)} y={COUNTS}>
                  ×{mark.records.length}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <p className="timeline-ends">
        <span>{timeText(records[marks[0].records[0]])}</span>
        <span>{timeText(records[marks[last].records[0]])}</span>
      </p>
      <p className="timeline-note" id="timeline-hint">
        {STRIP_HINT}
      </p>
    </>
  );
}

interface LongestProps {
  longest: LongestGap;
  records: readonly ImportedSourceRecord[];
  onShowRecord: (place: number) => void;
}

/** The longest gap, named once: its length, the two records it lies between, and the way to it in the list. */
function Longest({ longest, records, onShowRecord }: LongestProps) {
  const [length, between] = longestGapWords(longest, records[longest.from], records[longest.to]);
  return (
    <p className="timeline-longest">
      <span className="swatch swatch-population" aria-hidden="true" />
      <strong>{length}</strong>, {between}{" "}
      <button type="button" className="link-button" onClick={() => onShowRecord(longest.to)}>
        Show this gap in the list
      </button>
    </p>
  );
}

/** The gap before a record, as a line of its entry in the list; nothing for the first record or while the gaps are withheld. */
export function GapSince({ gap, longest }: { gap: Gap | undefined; longest: boolean }) {
  const line = gap === undefined ? null : gapLine(gap);
  if (line === null) return null;
  return (
    <p className={longest ? "history-gap longest" : "history-gap"}>
      {longest && <span className="swatch swatch-population" aria-hidden="true" />}
      {line}
    </p>
  );
}
