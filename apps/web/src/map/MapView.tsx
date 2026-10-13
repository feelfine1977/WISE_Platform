import { useCallback, useEffect, useMemo, useState } from "react";
import { type AbstractOptions, type ActivityLabelOptions, activityReferences, filterPositions, type FlowGraph, layoutUnion, type Measure, type MenuAction, type MenuTarget, type Positions } from "wise-flow";
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
import type { StageDefinitions } from "../stages/definitions";
import { StagesEditor } from "../stages/StagesEditor";
import { type StagedReading, useStages } from "../stages/store";
import { CANVAS_FROM, mapDetail, WHOLE_DETAIL } from "./detail";
import { DetailStrip } from "./DetailStrip";
import { elementOf, selectedElement, stepChoices } from "./elements";
import { fitToFrame } from "./FitToFrame";
import { flowCoverage, leastFlowIncidents, rankedDetail, shownActivities, showsStageNodes, stageOrder, toFlowGraph } from "./graph";
import { askedFor, OPENING_MEASURE } from "./measures";
import { activityTimeLines, boundaryLine, coverageRows, flowsLine, mapCaption } from "./wording";

/** The layout runs in the library's workers, so that the page stays responsive while it runs. */
const workers = { elkWorkerUrl, dagreWorkerUrl };
/** Above this many activities the map opens on the most frequent ones; its detail controls show the rest. */
export const MANY_ACTIVITIES = 20;
/** Above this many paths the map opens on its most frequent ones, so that the main flow can be read; its detail controls show the rest. */
export const MANY_PATHS = 30;
/** How many paths for each shown activity such a map opens on. */
const OPENING_PATHS_PER_ACTIVITY = 1.5;

/**
 * Where the detail of a map of this many activities and paths opens: everything, or the most
 * frequent activities with their most frequent paths, a main flow of about one and a half paths for
 * each shown activity however many paths there are. Nothing is left out of the counts: the detail
 * controls say how much is shown and show the rest.
 */
export function openingDetail(activities: number, paths = 0): AbstractOptions | undefined {
  if (activities <= MANY_ACTIVITIES && paths <= MANY_PATHS) return undefined;
  const shown = Math.min(activities, MANY_ACTIVITIES);
  const main = Math.ceil(shown * OPENING_PATHS_PER_ACTIVITY);
  return { activityDetail: shown / activities, pathDetail: paths > main ? main / paths : 1 };
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
 * activities' positions from it, so nothing moves when incidents are removed or kept again. The
 * stages of the log shape the arrangement, so it is computed anew once they are changed.
 */
const arrangements = new WeakMap<SuppliedGraph, { stages: StageDefinitions; arranged: Promise<Positions> }>();

function arrangementOf(parentGraph: SuppliedGraph, parent: FlowGraph, stages: StageDefinitions): Promise<Positions> {
  const held = arrangements.get(parentGraph);
  if (held?.stages === stages) return held.arranged;
  const arranged = layoutUnion([parent], workers);
  arrangements.set(parentGraph, { stages, arranged });
  arranged.catch(() => arrangements.get(parentGraph)?.arranged === arranged && arrangements.delete(parentGraph));
  return arranged;
}

/** The arrangement of the whole parent in its stages, asked for only while the activities are to keep their places. */
function useParentArrangement(parentGraph: SuppliedGraph, parent: FlowGraph, stages: StageDefinitions, wanted: boolean): Arrangement {
  const [arranged, setArranged] = useState<{ parent: FlowGraph; arrangement: Arrangement } | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let current = true;
    arrangementOf(parentGraph, parent, stages).then(
      (positions) => current && setArranged({ parent, arrangement: { phase: "ready", positions } }),
      () => current && setArranged({ parent, arrangement: { phase: "unavailable" } }),
    );
    return () => {
      current = false;
    };
  }, [parentGraph, parent, stages, wanted]);
  return arranged?.parent === parent ? arranged.arrangement : { phase: "arranging" };
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
  // The stages the analyst defined for the reading shown; the map draws its activities in them.
  const workspaceId = shown.answer.workspace_id;
  const preparationId = shown.answer.identity.preparation_id;
  const reading = useMemo<StagedReading>(() => ({ workspaceId, preparationId }), [workspaceId, preparationId]);
  const { definitions: stages, revision: stagesRevision } = useStages(reading);
  const parent = useMemo(() => toFlowGraph(parentGraph, 0, undefined, stages), [parentGraph, stages]);
  /**
   * Every activity is written with its whole name, on up to two lines, and its incidents: the cards
   * take the width that needs. The references are those of the whole parent, so that an activity
   * keeps its own from one selection to the next.
   */
  const activityLabels = useMemo<ActivityLabelOptions>(
    () => ({ mode: "names", references: activityReferences(parent), showCounts: true, caseLabel: "incidents" }),
    [parent],
  );
  const opening = useMemo(() => openingDetail(parentGraph.nodes.length, parentGraph.edges.length), [parentGraph]);
  const least = useMemo(() => leastPaths(parentGraph.nodes.length, parentGraph.edges.length), [parentGraph]);
  // The detail is held here, so that the paths share cannot go below the main flow.
  const [detail, setDetail] = useState<AbstractOptions | undefined>(opening);
  useEffect(() => setDetail(opening), [opening]);
  const changeDetail = useCallback(
    (next: AbstractOptions) => setDetail(least !== null && (next.pathDetail ?? 1) < least ? { ...next, pathDetail: least } : next),
    [least],
  );
  // The paths are ranked by their incidents, the number the map writes on them. The map is always given a detail, so that it holds none of its own.
  const ranked = useMemo(() => rankedDetail(detail) ?? WHOLE_DETAIL, [detail]);
  // The flows from Start and to End follow the paths: a flow weaker than the weakest path drawn by frequency is not drawn.
  // While a stage is shown as one node every flow is handed over: the flow of a stage adds up those of its activities, and none may be missing from it.
  const stageNodes = showsStageNodes(detail);
  const leastFlow = useMemo(() => (stageNodes ? 0 : leastFlowIncidents(shown.graph, detail)), [shown.graph, detail, stageNodes]);
  // A flow of an activity the detail does not show is not on the map; the strongest flow of each side is kept among those shown.
  const shownIds = useMemo(() => (stageNodes ? undefined : shownActivities(shown.graph, detail)), [shown.graph, detail, stageNodes]);
  const graph = useMemo(() => toFlowGraph(shown.graph, leastFlow, shownIds, stages), [shown.graph, leastFlow, shownIds, stages]);
  // With stages as nodes the flows are merged for each stage, so the count of single flows drawn is not said there.
  const flowsNotDrawn = useMemo(
    () => (stageNodes ? null : flowsLine(flowCoverage(shown.graph, leastFlow, shownIds), leastFlow)),
    [shown.graph, leastFlow, shownIds, stageNodes],
  );
  /**
   * What the map draws of that graph at this detail, and what its detail controls say, computed as
   * the map library computes them. The controls stand above the canvas, where they take no room
   * from the map. On the library's Canvas they stay the library's own panel inside the map: there
   * the panel also says how many of the selected paths are drawn at the zoom, which only the map knows.
   */
  const detailShown = useMemo(() => mapDetail(graph, ranked), [graph, ranked]);
  const controlsAbove = !detailShown.onCanvas;
  /** Whether the map is shown as the map library's table of its activities and paths; the detail controls switch it. */
  const [view, setView] = useState<"map" | "table">("map");
  /**
   * How the map is arranged. By default it is arranged anew, compactly, for exactly what is shown:
   * the activities and paths the detail leaves out do not shape the picture. On request every
   * activity keeps the place the whole parent's map gives it, so that selections can be compared
   * by eye; hidden paths then still decide the places and the routes.
   */
  const [inPlace, setInPlace] = useState(initiallyInPlace);
  const arrangement = useParentArrangement(parentGraph, parent, stages, inPlace);
  const positions = useMemo(
    () => (inPlace && arrangement.phase === "ready" ? filterPositions(arrangement.positions, graph) : undefined),
    [inPlace, arrangement, graph],
  );
  const [selection, setSelection] = useState<Selection>(emptySelection);
  /**
   * What the map writes on its paths and activities: the incidents on them, or the supplied median
   * times. The analyst chooses in the map's own legend. The choice is held here, so that it outlasts
   * a map that is drawn again for other incidents or arranged another way.
   */
  const [measure, setMeasure] = useState<Measure>(OPENING_MEASURE);
  // The map library colours the stages by the whole list of them, so a stage keeps its colour on a map that has no activity of another.
  const asked = useMemo(() => {
    const { measure: named, style } = askedFor(measure);
    return { measure: named, style: stages.stages.length === 0 ? style : { ...style, stages: stageOrder(stages) } };
  }, [measure, stages]);

  // A new map is of other incidents: what was selected on the previous one is not carried over.
  useEffect(() => setSelection(emptySelection), [shown.graph]);

  const element = selectedElement(shown.graph, selection);
  const choices = stepChoices(element);
  // A stage shown as one node is no supplied activity: it is named, and no step is taken from it.
  const stageNode = element?.kind === "unrecorded" ? stages.stages.find((stage) => stage.id === selection.nodes[0]) : undefined;

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
    <div className="map-view" data-element={element === null ? "none" : "selected"}>
      <div className="map-main">
        {controlsAbove && <DetailStrip detail={ranked} shown={detailShown} onChange={changeDetail} view={view} onViewChange={setView} />}
        <div className="map-frame">
          {inPlace && arrangement.phase === "arranging" ? (
            <p className="working-text map-arranging">Arranging the map of every incident of the parent…</p>
          ) : (
            <ProcessMap
              graph={graph}
              positions={positions}
              layout={workers}
              abstraction={ranked}
              onAbstractionChange={changeDetail}
              view={view}
              onViewChange={setView}
              // Drawn on the Canvas from the same number of elements as the detail controls reckon with.
              canvasThreshold={CANVAS_FROM}
              // Drawn as elements, the map draws every path its detail selects, which is what the controls above it say.
              edgeBudget={controlsAbove ? "all" : "adaptive"}
              activityLabels={activityLabels}
              // The chosen measure, with what is laid over the library's style of it.
              {...asked}
              // Listening for the choice is what makes the map's whole legend offer the measures.
              onMeasureChange={setMeasure}
              // Arranged anew, the map is fitted each time. In place, the map of the whole parent is fitted
              // and a selection keeps that view, so nothing moves on screen.
              fitView={inPlace ? shown.steps.length === 0 : true}
              // An activity moved by hand goes back when the map is arranged anew for other content or for other stages.
              layoutResetKey={`${inPlace ? "in-place" : `${shown.revision}:${detail?.activityDetail ?? 1}:${detail?.pathDetail ?? 1}`}:${stagesRevision}`}
              // Names are drawn from a smaller zoom on than the library's default, so that an overview still names its activities.
              lod={LABELS_FROM}
              // The library's own detail panel inside the map, only where the controls are not above it.
              controls={!controlsAbove}
              legend
              minimap
              pathList
              nodesDraggable
              locale="en"
              selection={selection}
              onSelect={setSelection}
              onContextMenu={menu}
              ariaLabel="Process map of the kept incidents"
            >
              {/* Fitted after each arrangement by the library, and here again when the frame changes its size. */}
              {fitToFrame}
            </ProcessMap>
          )}
        </div>
      </div>
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
        {element?.kind === "unrecorded" && stageNode === undefined && (
          <p className="muted">This line stands for activities the map does not show. It is not a recorded path, so no step is taken from it.</p>
        )}
        {stageNode !== undefined && (
          <p className="muted">
            The stage “{stageNode.name}” stands for its activities. No step is taken from a stage: “Show activities” in the Detail panel of the map,
            or “Expand the stage” in the menu of the stage, draws its activities again.
          </p>
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
      <div className="map-notes">
        {flowsNotDrawn !== null && <p className="muted map-flows">{flowsNotDrawn}</p>}
        <details className="map-stages">
          <summary>Stages of this log</summary>
          <StagesEditor reading={reading} parentGraph={parentGraph} />
        </details>
        <details className="map-options">
          <summary>How the map is arranged and what it counts</summary>
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
          <MapCaption graph={shown.graph} />
        </details>
      </div>
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
