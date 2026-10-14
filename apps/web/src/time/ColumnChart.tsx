import { type KeyboardEvent, type PointerEvent, useId, useRef, useState } from "react";

/** One column of a chart: what it stands for, and how many incidents of the parent and of the kept ones it counts. */
export interface ChartBin {
  label: string;
  parent: number;
  kept: number;
}

interface ColumnChartProps {
  /** The name of the chart for assistive technology. */
  name: string;
  /** A chart only to read: no column takes a step, and nothing says that one would. */
  readOnly?: boolean;
  bins: readonly ChartBin[];
  /** Whether neighbouring columns can be chosen together as one band, or one column at a time. */
  band: boolean;
  /** Whether a step can be taken from these columns; one that cannot is still read out. */
  applicable: (from: number, to: number) => boolean;
  /** What the chosen columns stand for together, in short words. */
  chosenName: (from: number, to: number) => string;
  /** The words of the step these columns take, read out while they are chosen. */
  stepName: (from: number, to: number) => string;
  onApply: (from: number, to: number) => void;
  /** While a step is under way no other is taken; the id names what is awaited. */
  waitingFor?: string;
  /** The words under the first and the last column. */
  ticks: [string, string];
}

/** The height of a plot in the units of its drawing, and the width of one column there. */
const HEIGHT = 96;
const WIDTH = 10;
const integer = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/**
 * Columns of the parent, pale, with the kept incidents over them, solid, on one baseline; the
 * columns under the hand are blue, a chosen band lies behind them in pale blue. The chart is one
 * stop of the keyboard: the arrow keys go from column to column, with Shift they widen the band,
 * and Enter takes the step. With the pointer a column is pressed, or a band is dragged. A step is
 * taken at once; the steps row undoes it.
 */
export function ColumnChart({ name, readOnly = false, bins, band, applicable, chosenName, stepName, onApply, waitingFor, ticks }: ColumnChartProps) {
  const hint = useId();
  const plot = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const highest = Math.max(1, ...bins.map((bin) => bin.parent));
  const height = (count: number) => (count === 0 ? 0 : Math.max(1, (count / highest) * HEIGHT));
  const from = cursor === null ? null : Math.min(anchor ?? cursor, cursor);
  const to = cursor === null ? null : Math.max(anchor ?? cursor, cursor);
  const last = bins.length - 1;

  function clear() {
    setAnchor(null);
    setCursor(null);
    setDragging(false);
  }

  function apply(start: number, end: number) {
    if (waitingFor !== undefined || !applicable(start, end)) return;
    onApply(start, end);
    // A step taken leaves the chart neutral again: the kept columns show what it kept.
    clear();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (bins.length === 0) return;
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step !== 0 || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? last : Math.min(last, Math.max(0, (cursor ?? (step > 0 ? -1 : 1)) + step));
      if (!(band && event.shiftKey && cursor !== null)) setAnchor(next);
      else if (anchor === null) setAnchor(cursor);
      setCursor(next);
    } else if ((event.key === "Enter" || event.key === " ") && from !== null && to !== null) {
      event.preventDefault();
      apply(from, to);
    } else if (event.key === "Escape" && cursor !== null) {
      event.preventDefault();
      clear();
    }
  }

  /** The column under the pointer, from where it lies across the plot. */
  function columnAt(event: PointerEvent): number | null {
    const box = plot.current?.getBoundingClientRect();
    if (!box || box.width === 0 || bins.length === 0) return null;
    return Math.min(last, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * bins.length)));
  }

  const chosen = from === null || to === null ? null : chosenName(from, to);
  const counted = from === null || to === null ? null : bins.slice(from, to + 1).reduce((sum, bin) => ({ kept: sum.kept + bin.kept, parent: sum.parent + bin.parent }), { kept: 0, parent: 0 });

  return (
    <div className="column-chart">
      <div
        ref={plot}
        className="column-chart-plot"
        role="group"
        aria-label={name}
        aria-describedby={[hint, waitingFor].filter(Boolean).join(" ")}
        tabIndex={0}
        data-chosen={cursor === null ? undefined : "yes"}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          const at = columnAt(event);
          if (at === null) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setAnchor(at);
          setCursor(at);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const at = columnAt(event);
          if (at === null) return;
          if (!dragging) setAnchor(at);
          if (dragging && !band) return;
          setCursor(at);
        }}
        onPointerUp={() => {
          if (dragging && from !== null && to !== null) apply(from, to);
          setDragging(false);
        }}
        onPointerLeave={() => {
          if (!dragging) clear();
        }}
        onBlur={() => {
          if (!dragging) clear();
        }}
      >
        <svg className="column-chart-svg" viewBox={`0 0 ${Math.max(1, bins.length) * WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          {band && from !== null && to !== null && from !== to && (
            <rect className="column-chart-band" x={from * WIDTH} y={0} width={(to - from + 1) * WIDTH} height={HEIGHT} />
          )}
          {bins.map((bin, place) => (
            <g key={place}>
              <rect className="column-chart-parent" x={place * WIDTH + 1} y={HEIGHT - height(bin.parent)} width={WIDTH - 2} height={height(bin.parent)} />
              <rect
                className={from !== null && to !== null && place >= from && place <= to ? "column-chart-kept column-chart-chosen" : "column-chart-kept"}
                x={place * WIDTH + 1}
                y={HEIGHT - height(bin.kept)}
                width={WIDTH - 2}
                height={height(bin.kept)}
              />
            </g>
          ))}
          <line className="column-chart-base" x1={0} x2={Math.max(1, bins.length) * WIDTH} y1={HEIGHT} y2={HEIGHT} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="column-chart-ticks" aria-hidden="true">
        <span>{ticks[0]}</span>
        <span>{ticks[1]}</span>
      </div>
      <p className="column-chart-readout" aria-live="polite">
        {chosen !== null && counted !== null && from !== null && to !== null && (
          <>
            <span className="column-chart-chosen-name">{chosen}</span> {integer.format(counted.kept)} of {integer.format(counted.parent)}
            {!readOnly && <span className="visually-hidden">. {applicable(from, to) ? `${stepName(from, to)}: Enter.` : "No step is taken from here."}</span>}
          </>
        )}
      </p>
      <p id={hint} className="visually-hidden">
        {readOnly
          ? "The arrow keys go from column to column and read each one out."
          : band
            ? "The arrow keys go from column to column; with Shift they widen the band. Enter takes the step, Escape lets go."
            : "The arrow keys go from column to column. Enter takes the step, Escape lets go."}
      </p>
    </div>
  );
}
