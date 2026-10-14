import { useState } from "react";
import type { SuppliedGraph } from "../generated/selection";
import "./activity-times.css";
import { activityNotes, duration, type PathOfActivity, pathsOf, timeRows } from "./activityTimes";

/** How many paths each list shows before it offers the rest. */
export const PATHS_SHOWN = 5;
const integer = new Intl.NumberFormat("en");

interface ActivityTimesCardProps {
  graph: SuppliedGraph;
  nodeId: string;
  /** Selects a path on the map, as a click on it there would. */
  onSelectPath: (edgeId: string) => void;
}

/**
 * The two times of a selected activity as figures with what they rest on, and the paths into and
 * out of it with their passages and lags, the strongest first, so that the analyst sees where a
 * long wait comes from. Every figure is a supplied one.
 */
export function ActivityTimesCard({ graph, nodeId, onSelectPath }: ActivityTimesCardProps) {
  const node = graph.nodes.find((item) => item.id === nodeId);
  const { into, out } = pathsOf(graph, nodeId);
  if (!node) return null;
  return (
    <div className="activity-times">
      <dl className="activity-times-rows">
        {timeRows(graph, nodeId).map((row) => (
          <div key={row.name}>
            <dt>{row.name}</dt>
            <dd>
              {row.median === null ? (
                <span className="muted">Not available: {row.reason}.</span>
              ) : (
                <>
                  median <strong>{duration(row.median)}</strong> · {integer.format(row.passages)} {row.passages === 1 ? "passage" : "passages"}
                  <span className="muted"> of {integer.format(node.metrics.count)} {node.metrics.count === 1 ? "record" : "records"}</span>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <PathList title="Paths in" side="from" activity={node.label} paths={into} onSelectPath={onSelectPath} />
      <PathList title="Paths out" side="to" activity={node.label} paths={out} onSelectPath={onSelectPath} />
      {activityNotes(graph, nodeId).map((note) => (
        <p key={note} className="muted activity-times-note">
          {note}
        </p>
      ))}
    </div>
  );
}

interface PathListProps {
  title: string;
  side: "from" | "to";
  activity: string;
  paths: readonly PathOfActivity[];
  onSelectPath: (edgeId: string) => void;
}

function PathList({ title, side, activity, paths, onSelectPath }: PathListProps) {
  const [all, setAll] = useState(false);
  const shown = all ? paths : paths.slice(0, PATHS_SHOWN);
  const rest = paths.length - shown.length;
  return (
    <section className="activity-paths" aria-label={`${title} of ${activity}`}>
      <h5 className="activity-paths-title">{title}</h5>
      {paths.length === 0 ? (
        <p className="muted">{side === "from" ? "No path leads into it." : "No path leads out of it."}</p>
      ) : (
        <ul className="activity-paths-list">
          {shown.map((path) => (
            <li key={path.id}>
              <button
                type="button"
                className="activity-path"
                aria-label={`${side === "from" ? `From ${path.other}` : `To ${path.other}`}: ${integer.format(path.passages)} passages, median lag ${path.lag === null ? "not available" : duration(path.lag)}. Select this path on the map.`}
                onClick={() => onSelectPath(path.id)}
              >
                <span className="activity-path-name">
                  {side} {path.other}
                </span>
                <span className="activity-path-count">{integer.format(path.passages)}</span>
                <span className="activity-path-lag">{path.lag === null ? "–" : duration(path.lag)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {rest > 0 && (
        <button type="button" className="activity-paths-more" onClick={() => setAll(true)}>
          {rest} more
        </button>
      )}
    </section>
  );
}
