import { type KeyboardEvent, type MouseEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CaseId, ImportedCaseSummary } from "../generated/imports";

/** Height of one table row in CSS pixels; the stylesheet gives every row exactly this height. */
export const ROW_HEIGHT = 32;
/** The columns of the table without times; a spacer cell spans them all and holds an empty drawing of the height it stands for. */
const COLUMNS = 5;

/** The recorded span and the longest gap of an incident in hours, as the local service supplied them; null where it has none. */
export interface IncidentTimes {
  span: number | null;
  gap: number | null;
}
/** Rows rendered above and below the visible ones, so that scrolling does not show empty space. */
const OVERSCAN = 8;
/** The visible height assumed until the browser has laid the table out. */
const FALLBACK_HEIGHT = 480;

export interface FocusRequest {
  caseId: CaseId;
  /** A new number asks again, even for the same incident. */
  token: number;
}

interface IncidentWindowProps {
  cases: readonly ImportedCaseSummary[];
  openCaseId: CaseId | null;
  onOpen: (caseId: CaseId) => void;
  /** Brings an incident into view and moves the focus to it. */
  focusRequest: FocusRequest | null;
  labelledBy: string;
  describedBy?: string;
  /** The id of the text saying why incidents cannot be opened now; while it is given, the rows only move the focus. */
  waitingFor?: string;
  /** The recorded span and longest gap of each incident, where the incidents are ordered by them; two more columns then show them. */
  times?: ReadonlyMap<CaseId, IncidentTimes>;
  /** How a duration in hours is written in a cell. */
  duration?: (hours: number) => string;
  /** More columns at the end, each with its head and the cell of each incident in view. */
  extras?: readonly ExtraColumn[];
  /** Told the incident of the current row whenever it changes, so that what is said of it can stand beside the table. */
  onActive?: (caseId: CaseId) => void;
}

/** A column after the counts and times of an incident: its head, and its cell for each incident in view. */
export interface ExtraColumn {
  head: string;
  cell: (caseId: CaseId) => ReactNode;
  /** "number" aligns the cell to the right. */
  className?: string;
}

/**
 * The incidents of a population as one table that renders only the rows in view. It keeps a
 * single tab stop: Tab enters the table at the current row, the arrow keys, Page Up, Page Down,
 * Home and End move between rows, and Enter opens the incident.
 */
export function IncidentWindow({ cases, openCaseId, onOpen, focusRequest, labelledBy, describedBy, waitingFor, times, duration = String, extras = [], onActive }: IncidentWindowProps) {
  const columns = (times === undefined ? COLUMNS : COLUMNS + 2) + extras.length;
  const scroller = useRef<HTMLDivElement>(null);
  const controls = useRef(new Map<number, HTMLButtonElement>()).current;
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(FALLBACK_HEIGHT);
  const [active, setActive] = useState(0);
  const [pendingFocus, setPendingFocus] = useState<number | null>(null);
  const indexOf = useMemo(() => new Map(cases.map((summary, index) => [summary.case_id, index])), [cases]);
  const last = cases.length - 1;

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setHeight(element.clientHeight > 0 ? element.clientHeight : FALLBACK_HEIGHT);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(last, 0)));
  }, [last]);

  const activeCase = cases[active]?.case_id;
  useEffect(() => {
    if (activeCase !== undefined) onActive?.(activeCase);
    // Only another incident in the current row is told; a new callback alone is not.
  }, [activeCase]); // eslint-disable-line react-hooks/exhaustive-deps

  const rowsInView = Math.max(1, Math.floor((height - ROW_HEIGHT) / ROW_HEIGHT));
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(cases.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);

  /** Scrolls the least distance that shows a row below the sticky header, and moves the focus there. */
  const reveal = useCallback(
    (index: number) => {
      const top = index * ROW_HEIGHT;
      const visible = height - ROW_HEIGHT;
      let next = scrollTop;
      if (top < scrollTop) next = top;
      else if (top + ROW_HEIGHT > scrollTop + visible) next = top + ROW_HEIGHT - visible;
      if (next !== scrollTop) {
        if (scroller.current) scroller.current.scrollTop = next;
        setScrollTop(next);
      }
      setActive(index);
      setPendingFocus(index);
    },
    [height, scrollTop],
  );

  useEffect(() => {
    if (pendingFocus === null) return;
    const control = controls.get(pendingFocus);
    if (control) {
      control.focus();
      setPendingFocus(null);
    }
  });

  useEffect(() => {
    if (focusRequest === null) return;
    const index = indexOf.get(focusRequest.caseId);
    if (index !== undefined) reveal(index);
    // Only a new request moves the focus; the reveal it uses changes with every scroll.
  }, [focusRequest, indexOf]);

  const moves: Record<string, (index: number) => number> = {
    ArrowDown: (index) => Math.min(index + 1, last),
    ArrowUp: (index) => Math.max(index - 1, 0),
    PageDown: (index) => Math.min(index + rowsInView, last),
    PageUp: (index) => Math.max(index - rowsInView, 0),
    Home: () => 0,
    End: () => last,
  };

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    reveal(move(index));
  }

  function openFromRow(event: MouseEvent<HTMLTableRowElement>, caseId: CaseId, index: number) {
    if ((event.target as Element).closest("button")) return;
    setActive(index);
    if (!waitingFor) onOpen(caseId);
  }

  /** The rows to render: those in view, and the current row wherever it is, so that it keeps the focus. */
  const indexes: number[] = [];
  if (cases.length > 0 && active < first) indexes.push(active);
  for (let index = first; index < end; index += 1) indexes.push(index);
  if (cases.length > 0 && active >= end && active < cases.length) indexes.push(active);

  function row(index: number) {
    const summary = cases[index];
    const open = summary.case_id === openCaseId;
    return (
      <tr
        key={summary.case_id}
        aria-rowindex={index + 2}
        className={open ? "selected" : undefined}
        onClick={(event) => openFromRow(event, summary.case_id, index)}
      >
        <th scope="row">
          <button
            type="button"
            className="row-open"
            tabIndex={index === active ? 0 : -1}
            aria-current={open ? "true" : undefined}
            aria-disabled={waitingFor ? "true" : undefined}
            aria-describedby={waitingFor}
            title={summary.case_id}
            ref={(element) => {
              if (element) controls.set(index, element);
              else controls.delete(index);
            }}
            onFocus={() => setActive(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => {
              setActive(index);
              if (!waitingFor) onOpen(summary.case_id);
            }}
          >
            {summary.case_id}
          </button>
        </th>
        <td className="number">{summary.record_count}</td>
        <td className="number">{summary.mapped_record_count}</td>
        <td className="number">{summary.omitted_activity_record_count}</td>
        <td>{summary.sequence_evaluable ? "By time" : <span className="flag">Not fully known</span>}</td>
        {times !== undefined && (
          <>
            <td className="number">{durationCell(times.get(summary.case_id)?.span ?? null)}</td>
            <td className="number">{durationCell(times.get(summary.case_id)?.gap ?? null)}</td>
          </>
        )}
        {extras.map((extra) => (
          <td key={extra.head} className={extra.className ?? "extra-cell"}>{extra.cell(summary.case_id)}</td>
        ))}
      </tr>
    );
  }

  /** A duration where the service supplied one; a muted dash where it has none. */
  function durationCell(hours: number | null) {
    return hours === null ? <span className="muted" title="Not available for this incident">–</span> : duration(hours);
  }

  /** Rendered rows with spacers of the height of the rows between them, so every row keeps its place. */
  const body = [];
  let next = 0;
  for (const index of indexes) {
    if (index > next) body.push(<tr key={`gap-${next}`} className="window-spacer" aria-hidden="true"><td colSpan={columns}><svg width="1" height={(index - next) * ROW_HEIGHT} /></td></tr>);
    body.push(row(index));
    next = index + 1;
  }
  if (next < cases.length) body.push(<tr key={`gap-${next}`} className="window-spacer" aria-hidden="true"><td colSpan={columns}><svg width="1" height={(cases.length - next) * ROW_HEIGHT} /></td></tr>);

  return (
    <div
      className={extras.length > 1 ? "window-scroll wide" : "window-scroll"}
      ref={scroller}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <table className={extras.length > 1 ? "window-table wide" : "window-table"} aria-labelledby={labelledBy} aria-describedby={describedBy} aria-rowcount={cases.length + 1}>
        <thead>
          <tr aria-rowindex={1}>
            <th scope="col">Incident</th>
            <th scope="col" className="number">Records</th>
            <th scope="col" className="number">Mapped records</th>
            <th scope="col" className="number">Without activity label</th>
            <th scope="col">Order of records</th>
            {times !== undefined && (
              <>
                <th scope="col" className="number">Span</th>
                <th scope="col" className="number">Longest gap</th>
              </>
            )}
            {extras.map((extra) => (
              <th key={extra.head} scope="col" className={extra.className}>{extra.head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body}
        </tbody>
      </table>
    </div>
  );
}
