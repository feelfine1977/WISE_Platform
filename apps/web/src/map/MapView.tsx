import { useCallback, useEffect, useMemo, useState } from "react";
import { type AbstractOptions, filterPositions, type FlowGraph, layoutUnion, type MenuAction, type MenuTarget, type Positions } from "wise-flow";
import dagreWorkerUrl from "wise-flow/dagre-worker.min.js?url";
import elkWorkerUrl from "wise-flow/elk-worker.min.js?url";
import flowPackage from "wise-flow/package.json";
import { emptySelection, ProcessMap, type Selection } from "wise-flow/react";
// The page has unlayered base rules, so the library's styles come unlayered too, after React Flow's.
import "wise-flow/react-flow.css";
import "wise-flow/style.unlayered.css";
import { countOf } from "../data/wording";
import type { SelectionPredicate, SuppliedGraph } from "../generated/selection";
import type { ShownSelection } from "../imported/coordinator";
import { elementOf, selectedElement, stepChoices } from "./elements";
import { toFlowGraph } from "./graph";
import { activityTimeLines, boundaryLine, coverageRows, mapCaption } from "./wording";

/** The layout runs in the library's workers, so that the page stays responsive while it runs. */
const workers = { elkWorkerUrl, dagreWorkerUrl };
/** Above this many activities the map opens on the most frequent ones; its detail panel shows the rest. */
export const MANY_ACTIVITIES = 20;
const OPENING_PATHS = 0.5;
/** Above this many paths the map opens on its most frequent ones, so that the main flow can be read; its detail panel shows the rest. */
export const MANY_PATHS = 30;
/** How many paths for each activity such a map opens on. */
const OPENING_PATHS_PER_ACTIVITY = 1.5;

/**
 * Where the detail of a map of this many activities and paths opens: everything, the most frequent
 * activities, or every activity with its most frequent paths. Nothing is left out of the counts:
 * the detail panel says how much is shown and shows the rest.
 */
export function openingDetail(activities: number, paths = 0): AbstractOptions | undefined {
  if (activities > MANY_ACTIVITIES) return { activityDetail: MANY_ACTIVITIES / activities, pathDetail: OPENING_PATHS };
  if (paths > MANY_PATHS) return { activityDetail: 1, pathDetail: Math.ceil(activities * OPENING_PATHS_PER_ACTIVITY) / paths };
  return undefined;
}

/** The zoom from which the names on the activities are drawn. */
const LABELS_FROM = { labels: 0.12 };

/** The actions of the map library's own menu that change only the picture and that the map carries out by itself. */
const LIBRARY_ACTIONS = new Set(["paths", "clear-focus", "collapse", "expand"]);

/**
 * The smallest share of paths a map of this many activities and paths shows: as many of its most
 * frequent paths as it has activities, so that the lowest position of the detail still shows a main
 * flow and never activities standing alone. Null when the map has no more paths than that.
 */
export function leastPaths(activities: number, paths: number): number | null {
  return paths > activities && activities > 0 ? activities / paths : null;
}

type Arrangement = { phase: "arranging" } | { phase: "ready"; positions: Positions } | { phase: "unavailable" };

/**
 * One arrangement for each map of a whole parent, computed once: every selection's map reads its
 * activities' positions from it, so nothing moves when incidents are removed or kept again.
 */
const arrangements = new WeakMap<SuppliedGraph, Promise<Positions>>();

function arrangementOf(parentGraph: SuppliedGraph, parent: FlowGraph): Promise<Positions> {
  let arranged = arrangements.get(parentGraph);
  if (!arranged) {
    arranged = layoutUnion([parent], workers);
    arrangements.set(parentGraph, arranged);
    arranged.catch(() => arrangements.delete(parentGraph));
  }
  return arranged;
}

/** The arrangement of the whole parent, asked for only while the activities are to keep their places. */
function useParentArrangement(parentGraph: SuppliedGraph, parent: FlowGraph, wanted: boolean): Arrangement {
  const [arranged, setArranged] = useState<{ graph: SuppliedGraph; arrangement: Arrangement } | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let current = true;
    arrangementOf(parentGraph, parent).then(
      (positions) => current && setArranged({ graph: parentGraph, arrangement: { phase: "ready", positions } }),
      () => current && setArranged({ graph: parentGraph, arrangement: { phase: "unavailable" } }),
    );
    return () => {
      current = false;
    };
  }, [parentGraph, parent, wanted]);
  return arranged?.graph === parentGraph ? arranged.arrangement : { phase: "arranging" };
}

interface MapViewProps {
  shown: ShownSelection;
  /** The map of every incident of the parent; its arrangement places every map of a selection. */
  parentGraph: SuppliedGraph;
  onStep: (step: SelectionPredicate) => void;
  /** The id of the text saying why no step can be taken now; while it is given, the map offers none. */
  waitingFor?: string;
  /** Whether the map starts with every activity kept in the place the whole parent's map gives it. */
  initiallyInPlace?: boolean;
}

/** The process map of the kept incidents, with the steps an activity, a path or a flow from Start or to End offers. */
export function MapView({ shown, parentGraph, onStep, waitingFor, initiallyInPlace = false }: MapViewProps) {
  const parent = useMemo(() => toFlowGraph(parentGraph), [parentGraph]);
  const graph = useMemo(() => toFlowGraph(shown.graph), [shown.graph]);
  /**
   * How the map is arranged. By default it is arranged anew, compactly, for exactly what is shown:
   * the activities and paths the detail leaves out do not shape the picture. On request every
   * activity keeps the place the whole parent's map gives it, so that selections can be compared
   * by eye; hidden paths then still decide the places and the routes.
   */
  const [inPlace, setInPlace] = useState(initiallyInPlace);
  const arrangement = useParentArrangement(parentGraph, parent, inPlace);
  const positions = useMemo(
    () => (inPlace && arrangement.phase === "ready" ? filterPositions(arrangement.positions, graph) : undefined),
    [inPlace, arrangement, graph],
  );
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const opening = useMemo(() => openingDetail(parentGraph.nodes.length, parentGraph.edges.length), [parentGraph]);
  const least = useMemo(() => leastPaths(parentGraph.nodes.length, parentGraph.edges.length), [parentGraph]);
  // The detail is held here, so that the paths share cannot go below the main flow.
  const [detail, setDetail] = useState<AbstractOptions | undefined>(opening);
  useEffect(() => setDetail(opening), [opening]);
  const changeDetail = useCallback(
    (next: AbstractOptions) => setDetail(least !== null && (next.pathDetail ?? 1) < least ? { ...next, pathDetail: least } : next),
    [least],
  );

  // A new map is of other incidents: what was selected on the previous one is not carried over.
  useEffect(() => setSelection(emptySelection), [shown.graph]);

  const element = selectedElement(shown.graph, selection);
  const choices = stepChoices(element);

  /**
   * The actions menu of an element: the steps that keep or remove whole incidents, which are the
   * application's own, and after them what the map library does by itself on the picture (the paths
   * of an activity, groups, the focus). The library's own filters and the actions that need a host
   * are left out: a filter of the picture would look like a second selection.
   */
  const menu = useCallback(
    (target: MenuTarget, library: MenuAction[]): MenuAction[] | false => {
      const pictured = library.filter((action) => LIBRARY_ACTIONS.has(action.id));
      const steps =
        (target.kind === "node" || target.kind === "edge") && !waitingFor
          ? stepChoices(elementOf(shown.graph, target.kind, target.id)).map(
              (choice, index): MenuAction => ({ id: `keep-${index}`, label: choice.label, group: "filter", run: () => onStep(choice.step) }),
            )
          : [];
      const actions = [...steps, ...pictured];
      return actions.length === 0 ? false : actions;
    },
    [shown.graph, onStep, waitingFor],
  );

  return (
    <div className="map-view">
      <div className="map-frame">
        {inPlace && arrangement.phase === "arranging" ? (
          <p className="working-text map-arranging">Arranging the map of every incident of the parent…</p>
        ) : (
          <ProcessMap
            graph={graph}
            positions={positions}
            layout={workers}
            abstraction={detail}
            onAbstractionChange={changeDetail}
            // Arranged anew, the map is fitted each time. In place, the map of the whole parent is fitted
            // and a selection keeps that view, so nothing moves on screen.
            fitView={inPlace ? shown.steps.length === 0 : true}
            // An activity moved by hand goes back when the map is arranged anew for other content.
            layoutResetKey={inPlace ? "in-place" : `${shown.revision}:${detail?.activityDetail ?? 1}:${detail?.pathDetail ?? 1}`}
            // Names are drawn from a smaller zoom on than the library's default, so that an overview still names its activities.
            lod={LABELS_FROM}
            controls
            legend
            minimap
            pathList
            nodesDraggable
            locale="en"
            selection={selection}
            onSelect={setSelection}
            onContextMenu={menu}
            ariaLabel="Process map of the kept incidents"
          />
        )}
      </div>
      <label className="map-arrange">
        <input type="checkbox" checked={inPlace} onChange={(event) => setInPlace(event.target.checked)} />
        <span>
          Keep every activity in the place the map of all incidents gives it.{" "}
          <span className="muted">
            Off, the map is arranged anew and compactly for what is shown. On, places stay the same from one selection to the next, and
            hidden paths still shape the picture.
          </span>
        </span>
      </label>
      {inPlace && arrangement.phase === "unavailable" && (
        <p className="limitation">
          The arrangement of every incident of the parent could not be computed. The map arranges the kept incidents by itself, so activities can
          move from one selection to the next.
        </p>
      )}
      <section className="map-element" aria-labelledby="map-element-title" aria-live="polite">
        <h4 id="map-element-title" className="pane-title">
          {element?.kind === "activity"
            ? `Activity “${element.label}”`
            : element?.kind === "path"
              ? `Path from “${element.source}” to “${element.target}”`
              : element?.kind === "boundary"
                ? element.side === "start"
                  ? `Flow from Start to “${element.activity}”`
                  : `Flow from “${element.activity}” to End`
                : "Keep or remove incidents"}
        </h4>
        {element === null && (
          <p className="muted">Select an activity or a path on the map, or a row of its table view, to keep or remove the incidents through it.</p>
        )}
        {element?.kind === "several" && <p className="muted">Select one activity or one path; a step is taken from one of them.</p>}
        {element?.kind === "activity" &&
          activityTimeLines(element.times).map((line) => (
            <p key={line} className="muted">
              {line}
            </p>
          ))}
        {element?.kind === "path" && element.bridged > 0 && (
          <p className="limitation">
            In {countOf(element.bridged, "passage")} of {countOf(element.passages, "passage")}, records without activity label lie between the two
            activities; the path joins the labelled records around them.
          </p>
        )}
        {element?.kind === "boundary" && <p className="muted">{boundaryLine(element.side, element.activity, element.incidents)}</p>}
        {element?.kind === "unrecorded" && (
          <p className="muted">This line stands for activities the map does not show. It is not a recorded path, so no step is taken from it.</p>
        )}
        {choices.length > 0 && (
          <div className="map-choices">
            {choices.map((choice) => (
              <button key={choice.label} type="button" disabled={waitingFor !== undefined} aria-describedby={waitingFor} onClick={() => onStep(choice.step)}>
                {choice.label}
              </button>
            ))}
          </div>
        )}
      </section>
      <MapCaption graph={shown.graph} />
    </div>
  );
}

function MapCaption({ graph }: { graph: SuppliedGraph }) {
  return (
    <div className="map-caption">
      {mapCaption(graph.meta).map((line) => (
        <p key={line}>{line}</p>
      ))}
      <details className="map-coverage">
        <summary>What the map counts</summary>
        <dl className="pairs">
          {coverageRows(graph.meta).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </details>
      <p className="muted">
        The map is drawn with an unreleased state of the map library (wise-flow {flowPackage.version}, a local packaging candidate).
      </p>
    </div>
  );
}
