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
import { coverageRows, mapCaption } from "./wording";

/** The layout runs in the library's workers, so that the page stays responsive while it runs. */
const workers = { elkWorkerUrl, dagreWorkerUrl };
/** Above this many activities the map opens on the most frequent ones; its detail panel shows the rest. */
export const MANY_ACTIVITIES = 20;
const OPENING_PATHS = 0.5;

/** Where the detail of a map of this many activities opens: everything, or the most frequent activities. */
export function openingDetail(activities: number): AbstractOptions | undefined {
  return activities > MANY_ACTIVITIES ? { activityDetail: MANY_ACTIVITIES / activities, pathDetail: OPENING_PATHS } : undefined;
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

function useParentArrangement(parentGraph: SuppliedGraph, parent: FlowGraph): Arrangement {
  const [arranged, setArranged] = useState<{ graph: SuppliedGraph; arrangement: Arrangement } | null>(null);
  useEffect(() => {
    let current = true;
    arrangementOf(parentGraph, parent).then(
      (positions) => current && setArranged({ graph: parentGraph, arrangement: { phase: "ready", positions } }),
      () => current && setArranged({ graph: parentGraph, arrangement: { phase: "unavailable" } }),
    );
    return () => {
      current = false;
    };
  }, [parentGraph, parent]);
  return arranged?.graph === parentGraph ? arranged.arrangement : { phase: "arranging" };
}

interface MapViewProps {
  shown: ShownSelection;
  /** The map of every incident of the parent; its arrangement places every map of a selection. */
  parentGraph: SuppliedGraph;
  onStep: (step: SelectionPredicate) => void;
}

/** The process map of the kept incidents, with the steps an activity or a path offers. */
export function MapView({ shown, parentGraph, onStep }: MapViewProps) {
  const parent = useMemo(() => toFlowGraph(parentGraph), [parentGraph]);
  const graph = useMemo(() => toFlowGraph(shown.graph), [shown.graph]);
  const arrangement = useParentArrangement(parentGraph, parent);
  const positions = useMemo(() => (arrangement.phase === "ready" ? filterPositions(arrangement.positions, graph) : undefined), [arrangement, graph]);
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const opening = useMemo(() => openingDetail(parentGraph.nodes.length), [parentGraph]);

  // A new map is of other incidents: what was selected on the previous one is not carried over.
  useEffect(() => setSelection(emptySelection), [shown.graph]);

  const element = selectedElement(shown.graph, selection);
  const choices = stepChoices(element);

  const menu = useCallback(
    (target: MenuTarget): MenuAction[] | false => {
      if (target.kind !== "node" && target.kind !== "edge") return false;
      const offered = stepChoices(elementOf(shown.graph, target.kind, target.id));
      if (offered.length === 0) return false;
      return offered.map((choice, index) => ({ id: `keep-${index}`, label: choice.label, group: "filter", run: () => onStep(choice.step) }));
    },
    [shown.graph, onStep],
  );

  return (
    <div className="map-view">
      <div className="map-frame">
        {arrangement.phase === "arranging" ? (
          <p className="working-text map-arranging">Arranging the map of every incident of the parent…</p>
        ) : (
          <ProcessMap
            graph={graph}
            positions={positions}
            layout={workers}
            defaultAbstraction={opening}
            // The map of the whole parent is fitted; a selection keeps that view, so nothing moves on screen.
            fitView={shown.steps.length === 0}
            controls
            legend
            locale="en"
            selection={selection}
            onSelect={setSelection}
            onContextMenu={menu}
            ariaLabel="Process map of the kept incidents"
          />
        )}
      </div>
      {arrangement.phase === "unavailable" && (
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
              : "Keep or remove incidents"}
        </h4>
        {element === null && (
          <p className="muted">Select an activity or a path on the map, or a row of its table view, to keep or remove the incidents through it.</p>
        )}
        {element?.kind === "several" && <p className="muted">Select one activity or one path; a step is taken from one of them.</p>}
        {element?.kind === "path" && element.bridged > 0 && (
          <p className="limitation">
            In {countOf(element.bridged, "passage")} of {countOf(element.passages, "passage")}, records without activity label lie between the two
            activities; the path joins the labelled records around them.
          </p>
        )}
        {element?.kind === "unrecorded" && (
          <p className="muted">This line stands for activities the map does not show. It is not a recorded path, so no step is taken from it.</p>
        )}
        {choices.length > 0 && (
          <div className="map-choices">
            {choices.map((choice) => (
              <button key={choice.label} type="button" onClick={() => onStep(choice.step)}>
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
