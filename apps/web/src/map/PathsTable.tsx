import { type KeyboardEvent, useId, useMemo, useRef, useState } from "react";
import type { FlowGraph } from "wise-flow";
import { emptySelection, type Selection } from "wise-flow/react";
import type { SuppliedGraph } from "../generated/selection";
import "./canvas.css";
import "./paths.css";
import { lagTotalsOf, OPENING_ORDER, orderBy, type PathColumn, type PathOrder, pathRows, type PathRow, sortedRows } from "./paths";

const whole = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });

/** Why a row of a flow from Start or to End has a dash in a column. */
const FLOW_NOTE = "A flow has incidents only";

/** The columns in their order; a number stands at the right of its column. What a heading leaves unsaid is its tooltip. */
const COLUMNS: { column: PathColumn; label: string; number?: true; note?: string }[] = [
  { column: "from", label: "From" },
  { column: "to", label: "To" },
  { column: "incidents", label: "Incidents", number: true },
  { column: "passages", label: "Passages", number: true, note: FLOW_NOTE },
  { column: "total", label: "Total lag (days, all passages)", number: true, note: FLOW_NOTE },
  { column: "lag", label: "Median lag (h)", number: true, note: FLOW_NOTE },
  { column: "drawn", label: "On the map", note: "Drawn at the current detail" },
];

/** A number a row does not have: a quiet dash for the eye, an empty cell for assistive technology. */
const none = (
  <span className="muted" aria-hidden="true">
    –
  </span>
);

/** How many rows Page Up and Page Down move. */
const PAGE = 10;

interface PathsTableProps {
  /** The supplied graph of the kept incidents. */
  graph: SuppliedGraph;
  /** The graph the map draws at its detail: a row is drawn when it holds the row's path or flow. */
  drawn: FlowGraph;
  /** The selection of the map: a selected row is the path or the flow selected on the map. */
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

/**
 * Every path of the kept incidents in one list: each pair of activities of the supplied graph with
 * its supplied incidents, passages and median lag, and each flow from Start and to End with its
 * incidents. A column's heading sorts by it. Each row says whether the map draws it at the map's
 * detail, as a filled or a hollow dot with the words for assistive technology, and is selected as
 * its path or flow is selected on the map, which offers its steps beside the list. Nothing is
 * counted here.
 *
 * One row is a tab stop; the arrow keys, Page Up, Page Down, Home and End move between rows. What
 * the list is and how the keyboard moves in it is its description for assistive technology and is
 * not printed.
 */
export function PathsTable({ graph, drawn, selection, onSelect }: PathsTableProps) {
  const [order, setOrder] = useState<PathOrder>(OPENING_ORDER);
  const rows = useMemo(() => sortedRows(pathRows(graph, drawn), order), [graph, drawn, order]);
  // The supplied share of the paths with the largest total lag: said only in that order, where they are the first rows.
  const totals = lagTotalsOf(graph);
  const concentration =
    totals !== undefined && totals.top_five_share !== null && totals.top_five_path_ids.length > 0 && order.column === "total" && order.descending
      ? `The first ${totals.top_five_path_ids.length === 1 ? "path carries" : `${totals.top_five_path_ids.length} paths carry`} ${percent.format(totals.top_five_share)} of the total lag of all paths (${oneDecimal.format(totals.top_five_total_hours / 24)} of ${oneDecimal.format(totals.total_hours / 24)} days).`
      : null;
  const [active, setActive] = useState<string | null>(null);
  const controls = useRef(new Map<string, HTMLButtonElement>()).current;
  const hint = useId();
  // The row the keyboard was on last, or the first one while that row is not listed.
  const stop = rows.some((row) => row.id === active) ? active : (rows[0]?.id ?? null);
  const alone = selection.nodes.length === 0 && selection.groups.length === 0 && selection.edges.length === 1;

  /** A row is chosen as an element of the map is clicked: it alone is selected, or nothing when it was. */
  function choose(row: PathRow) {
    setActive(row.id);
    onSelect(alone && selection.edges[0] === row.id ? emptySelection : { nodes: [], edges: [row.id], groups: [] });
  }

  const last = rows.length - 1;
  const moves: Record<string, (index: number) => number> = {
    ArrowDown: (index) => Math.min(index + 1, last),
    ArrowUp: (index) => Math.max(index - 1, 0),
    PageDown: (index) => Math.min(index + PAGE, last),
    PageUp: (index) => Math.max(index - PAGE, 0),
    Home: () => 0,
    End: () => last,
  };

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const next = rows[move(index)];
    setActive(next.id);
    controls.get(next.id)?.focus();
  }

  return (
    <div className="path-list">
      <p className="visually-hidden" id={hint}>
        Every path between two activities of the kept incidents and every flow from Start and to End, with its supplied numbers; a flow has incidents
        only. “On the map” says whether the map draws it at the detail above. Select a row to keep or remove the incidents through it. Tab enters the
        list; the arrow keys, Page Up, Page Down, Home and End move.
      </p>
      {rows.length === 0 ? (
        <p className="working-text">The kept incidents have no path between two activities and no flow from Start or to End.</p>
      ) : (
        <>
        {concentration !== null && <p className="path-concentration">{concentration}</p>}
        <table className="path-table" aria-label="Paths of the kept incidents" aria-describedby={hint}>
          <thead>
            <tr>
              {COLUMNS.map(({ column, label, number, note }) => (
                // The column is named by its heading alone; the button in it says what it does, apart from the view of the same name.
                <th
                  key={column}
                  scope="col"
                  className={number ? "number column-number" : column === "drawn" ? "column-label" : undefined}
                  aria-label={label}
                  title={note}
                  aria-sort={order.column === column ? (order.descending ? "descending" : "ascending") : undefined}
                >
                  <button type="button" className="path-sort" aria-label={`${label}: sort the list`} onClick={() => setOrder((current) => orderBy(current, column))}>
                    {label}
                    {order.column === column && (
                      <span className="path-sort-mark" aria-hidden="true">
                        {order.descending ? "▼" : "▲"}
                      </span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const selected = selection.edges.includes(row.id);
              return (
                <tr
                  key={row.id}
                  className={selected ? "selected" : undefined}
                  onClick={(event) => {
                    if (!(event.target as Element).closest("button")) choose(row);
                  }}
                >
                  <th scope="row">
                    <button
                      type="button"
                      className="path-row"
                      aria-label={row.title}
                      aria-pressed={selected}
                      tabIndex={row.id === stop ? 0 : -1}
                      title={row.from}
                      ref={(element) => {
                        if (element) controls.set(row.id, element);
                        else controls.delete(row.id);
                      }}
                      onFocus={() => setActive(row.id)}
                      onKeyDown={(event) => onKeyDown(event, index)}
                      onClick={() => choose(row)}
                    >
                      {row.kind === "start" ? <span className="muted">{row.from}</span> : row.from}
                    </button>
                  </th>
                  <td title={row.to}>{row.kind === "end" ? <span className="muted">{row.to}</span> : row.to}</td>
                  <td className="number">{whole.format(row.incidents)}</td>
                  <td className="number">{row.passages === undefined ? none : whole.format(row.passages)}</td>
                  <td className="number">
                    {row.totalLag === undefined ? (
                      none
                    ) : (
                      <>
                        {/* Hours as supplied, written in days for display only. */}
                        {oneDecimal.format(row.totalLag.hours / 24)}
                        {row.shareOfTotalLag != null && <span className="muted path-share"> {percent.format(row.shareOfTotalLag)}</span>}
                      </>
                    )}
                  </td>
                  <td className="number">{row.medianLagHours === undefined ? none : oneDecimal.format(row.medianLagHours)}</td>
                  <td title={row.drawn ? "Drawn" : "Not drawn"}>
                    <span className="path-drawn" data-drawn={row.drawn} aria-hidden="true" />
                    <span className="visually-hidden">{row.drawn ? "Drawn" : "Not drawn"}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </>
      )}
    </div>
  );
}
