import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AbstractOptions, type ActivityLabelOptions, activityReferences, filterPositions, type FlowGraph, layoutUnion, type Measure, type MenuAction, type MenuTarget, type Positions } from "wise-flow";
import { emptySelection, ProcessMap, type Selection } from "wise-flow/react";
// The page has unlayered base rules, so the library's styles come unlayered too, after React Flow's.
import "wise-flow/react-flow.css";
import "wise-flow/style.unlayered.css";
import { IconButton } from "../components/icons";
import { countOf } from "../data/wording";
import type { SelectionPredicate, SuppliedGraph } from "../generated/selection";
import type { ShownSelection } from "../imported/coordinator";
import type { StageDefinitions } from "../stages/definitions";
import { StagesEditor } from "../stages/StagesEditor";
import { type StagedReading, useStages } from "../stages/store";
import { AboutMap } from "./AboutMap";
import { ActivityTimesCard } from "./ActivityTimesCard";
import { mapArrangement, type MapDirection, OPENING_DIRECTION, parentArrangement } from "./arrange";
import { CANVAS_FROM, mapDetail, WHOLE_DETAIL } from "./detail";
import { DetailStrip } from "./DetailStrip";
import { elementOf, selectedElement, stepChoices } from "./elements";
import { StepPreviewLine, type StepPreviewer } from "./StepPreviewLine";
import { elementTitle } from "./elementTitle";
import { fitToFrame } from "./FitToFrame";
import { flowCoverage, leastFlowIncidents, rankedDetail, shownActivities, showsStageNodes, stageOrder, toFlowGraph } from "./graph";
import { MAP_THEME, nodeSize } from "./look";
import "./look.css";
import { MapToolbar } from "./MapToolbar";
import { MeasureSwitch } from "./MeasureSwitch";
import { askedFor, OPENING_MEASURE } from "./measures";
import { PathsTable } from "./PathsTable";
import { boundaryLine, clockTag, flowsLine, unevaluableLine } from "./wording";

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
 * stages of the log and the way the map runs shape the arrangement, so it is computed anew once
 * either is changed.
 */
const arrangements = new WeakMap<SuppliedGraph, { stages: StageDefinitions; direction: MapDirection; arranged: Promise<Positions> }>();

function arrangementOf(parentGraph: SuppliedGraph, parent: FlowGraph, stages: StageDefinitions, direction: MapDirection): Promise<Positions> {
  const held = arrangements.get(parentGraph);
  if (held?.stages === stages && held.direction === direction) return held.arranged;
  const arranged = layoutUnion([parent], { ...parentArrangement(parent, direction), nodeSize });
  arrangements.set(parentGraph, { stages, direction, arranged });
  arranged.catch(() => arrangements.get(parentGraph)?.arranged === arranged && arrangements.delete(parentGraph));
  return arranged;
}

/** The arrangement of the whole parent in its stages and the way the map runs, asked for only while the activities are to keep their places. */
function useParentArrangement(parentGraph: SuppliedGraph, parent: FlowGraph, stages: StageDefinitions, direction: MapDirection, wanted: boolean): Arrangement {
  const [arranged, setArranged] = useState<{ parent: FlowGraph; direction: MapDirection; arrangement: Arrangement } | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let current = true;
    arrangementOf(parentGraph, parent, stages, direction).then(
      (positions) => current && setArranged({ parent, direction, arrangement: { phase: "ready", positions } }),
      () => current && setArranged({ parent, direction, arrangement: { phase: "unavailable" } }),
    );
    return () => {
      current = false;
    };
  }, [parentGraph, parent, stages, direction, wanted]);
  return arranged?.parent === parent && arranged.direction === direction ? arranged.arrangement : { phase: "arranging" };
}

interface MapViewProps {
  shown: ShownSelection;
  /** The map of every incident of the parent; its arrangement places every map of a selection. */
  parentGraph: SuppliedGraph;
  onStep: (step: SelectionPredicate) => void;
  /** Counts what a step would keep before it is taken; without it the steps are offered without a preview. */
  previewStep?: StepPreviewer;
  /** The id of the text saying why no step can be taken now; while it is given, the map offers none. */
  waitingFor?: string;
  /** Whether the map starts with every activity kept in the place the whole parent's map gives it. */
  initiallyInPlace?: boolean;
  /**
   * What stands in the frame: the map, or the list of every path of the kept incidents. The list
   * shares the map's detail, its selection and its steps, so that it says what the map draws and
   * offers what the map offers; all of them stay when the one is shown in place of the other.
   */
  showing?: "map" | "paths";
  /** Shows the map in place of the list of every path; a path drawn from the list is shown there. */
  onShowMap?: () => void;
  /**
   * What stands in a column beside the map while nothing else does: the card of a selected element
   * and the editor of the stages take its place, and it keeps its state under them. Not beside the list of every path.
   */
  aside?: ReactNode;
}

/** What the mark on "About this map" says while some flows from Start or to End are not drawn; the panel says which. */
const FLOWS_NOT_DRAWN = "Some flows from Start and to End are not drawn at this detail";

/** That the arrangement of the whole parent is missing and what follows from it: short enough for one line above the map, and in full as its tooltip. */
const NOT_ARRANGED = "The arrangement of every incident of the parent could not be computed, so activities can move from one selection to the next.";
const NOT_ARRANGED_IN_FULL =
  "The arrangement of every incident of the parent could not be computed. " +
  "The map arranges the kept incidents by itself, so activities can move from one selection to the next.";

/**
 * The process map of the kept incidents, with the steps an activity, a path or a flow from Start or
 * to End offers; or, in its place, the list of every path and flow with the same steps. Nothing
 * stands under the map: its tools are a row of icons beside its detail controls, what there is to
 * know about it opens over it, and the steps of a selected element or the editor of the stages
 * stand beside it.
 */
export function MapView({ shown, parentGraph, onStep, previewStep, waitingFor, initiallyInPlace = false, showing = "map", aside, onShowMap }: MapViewProps) {
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
  /**
   * The paths drawn on request from the list of every path, whatever the detail: the map library keeps each with both its
   * ends. Drawing one changes no step; a map of other incidents draws by its detail again.
   */
  const [revealed, setRevealed] = useState<string[]>([]);
  useEffect(() => setRevealed([]), [shown.graph]);
  const drawnDetail = useMemo(() => (detail !== undefined && revealed.length > 0 ? { ...detail, keep: revealed } : detail), [detail, revealed]);
  // The paths are ranked by their incidents, the number the map writes on them. The map is always given a detail, so that it holds none of its own.
  const ranked = useMemo(() => rankedDetail(drawnDetail) ?? WHOLE_DETAIL, [drawnDetail]);
  // The flows from Start and to End follow the paths: a flow weaker than the weakest path drawn by frequency is not drawn.
  // While a stage is shown as one node every flow is handed over: the flow of a stage adds up those of its activities, and none may be missing from it.
  const stageNodes = showsStageNodes(detail);
  const leastFlow = useMemo(() => (stageNodes ? 0 : leastFlowIncidents(shown.graph, drawnDetail)), [shown.graph, drawnDetail, stageNodes]);
  // A flow of an activity the detail does not show is not on the map; the strongest flow of each side is kept among those shown.
  const shownIds = useMemo(() => (stageNodes ? undefined : shownActivities(shown.graph, drawnDetail)), [shown.graph, drawnDetail, stageNodes]);
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
  // The way the map runs is held here, so that the map and the arrangement of the whole parent run the same way.
  const [direction, setDirection] = useState<MapDirection>(OPENING_DIRECTION);
  // Start stands first and End last on what the map draws, as they do in the arrangement of the whole parent, and every node has the size it has there.
  const mapLayout = useMemo(() => ({ ...mapArrangement(detailShown.drawn, direction), nodeSize }), [detailShown.drawn, direction]);
  const listed = showing === "paths";
  // Over the list the controls are always above: no map is drawn there that would know more.
  const controlsAbove = listed || !detailShown.onCanvas;
  /** Whether the map is shown as the map library's table of its activities and paths; the detail controls switch it. */
  const [view, setView] = useState<"map" | "table">("map");
  /**
   * How the map is arranged. By default it is arranged anew, compactly, for exactly what is shown:
   * the activities and paths the detail leaves out do not shape the picture. On request every
   * activity keeps the place the whole parent's map gives it, so that selections can be compared
   * by eye; hidden paths then still decide the places and the routes.
   */
  const [inPlace, setInPlace] = useState(initiallyInPlace);
  const arrangement = useParentArrangement(parentGraph, parent, stages, direction, inPlace);
  const positions = useMemo(
    () => (inPlace && arrangement.phase === "ready" ? filterPositions(arrangement.positions, graph) : undefined),
    [inPlace, arrangement, graph],
  );
  /** Whether the map shows the small picture of the whole of it in its corner. It takes room from the map, so it is asked for. */
  const [overview, setOverview] = useState(false);
  /**
   * Whether the editor of the stages stands beside the map. It takes the place of the steps of a
   * selected element, which stays selected and has its steps back once the editor is closed.
   */
  const [editingStages, setEditingStages] = useState(false);
  const stagesSwitch = useRef<HTMLButtonElement>(null);
  const stagesTitle = useRef<HTMLHeadingElement>(null);
  // The editor opens after the map in the page: its title takes the keyboard, so that the work goes on there.
  useEffect(() => {
    if (editingStages) stagesTitle.current?.focus();
  }, [editingStages]);
  /** Closed from inside the editor, the keyboard goes back to the switch that opened it. */
  const closeStages = useCallback(() => {
    setEditingStages(false);
    stagesSwitch.current?.focus();
  }, []);
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
  /** Draws a path of the list on the map, beyond the detail when the detail leaves it out, selected, and shows the map. */
  const drawPath = (id: string) => {
    if (!detailShown.drawn.edges.some((edge) => edge.id === id)) setRevealed((current) => (current.includes(id) ? current : [...current, id]));
    setSelection({ nodes: [], edges: [id], groups: [] });
    onShowMap?.();
  };
  const selectedPathDrawn = element?.kind === "path" && detailShown.drawn.edges.some((edge) => edge.id === selection.edges[0]);
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

  // What limits every path and what every lag is measured on are never only behind "About this map".
  const unevaluable = unevaluableLine(shown.graph.meta);
  const clock = clockTag(shown.graph.meta);
  /**
   * What stands in the row above the map after the detail controls: the limit of an arrangement
   * that could not be computed, which is never left unsaid, the incidents not evaluable for paths
   * and the wall clock while there are any, and the tools of the map.
   */
  const tools = (
    <>
      {revealed.length > 0 && (
        <p className="map-limit">
          {countOf(revealed.length, "path")} drawn on request beyond the detail.{" "}
          <button type="button" className="link-button" onClick={() => setRevealed([])}>
            Draw by the detail only
          </button>
        </p>
      )}
      {inPlace && arrangement.phase === "unavailable" && (
        <p className="map-limit" title={NOT_ARRANGED_IN_FULL}>
          {NOT_ARRANGED}
        </p>
      )}
      {(unevaluable !== null || clock !== null) && (
        <p className="map-basis">
          {unevaluable !== null && <span className="map-basis-limit">{unevaluable}</span>}
          {clock !== null && (
            <span className="map-basis-tag" title={shown.graph.meta.clock_limitation ?? undefined}>
              {clock}
            </span>
          )}
        </p>
      )}
      <MapToolbar
        picture={!listed}
        direction={direction}
        onDirection={setDirection}
        inPlace={inPlace}
        onInPlace={setInPlace}
        overview={overview}
        onOverview={setOverview}
        editingStages={editingStages}
        onEditStages={setEditingStages}
        stagesSwitch={stagesSwitch}
        notDrawn={flowsNotDrawn === null ? undefined : FLOWS_NOT_DRAWN}
      >
        <AboutMap graph={shown.graph} statement={detailShown.statement} flowsNotDrawn={flowsNotDrawn} />
      </MapToolbar>
    </>
  );

  return (
    <div
      className="map-view"
      data-element={element === null ? "none" : "selected"}
      data-beside={editingStages ? "stages" : element !== null ? "element" : aside !== undefined && !listed ? "aside" : "none"}
    >
      <div className="map-main">
        {controlsAbove ? (
          // The switch to the map library's table belongs to the map; over the list of every path it is left out.
          <DetailStrip
            detail={ranked}
            shown={detailShown}
            onChange={changeDetail}
            view={listed ? undefined : view}
            onViewChange={listed ? undefined : setView}
            lead={listed ? undefined : <MeasureSwitch measure={measure} onMeasure={setMeasure} />}
          >
            {tools}
          </DetailStrip>
        ) : (
          // The map holds its detail controls itself: the row is the tools' alone.
          <div className="map-detail">
            <MeasureSwitch measure={measure} onMeasure={setMeasure} />
            {tools}
          </div>
        )}
        {listed ? (
          <PathsTable graph={shown.graph} drawn={detailShown.drawn} selection={selection} onSelect={setSelection} />
        ) : (
          // The stylesheet of the map's look reads from the frame which way the map runs and whether any activity on it is in a stage.
          <div className="map-frame" data-direction={direction} data-stages={graph.groups?.length ? "drawn" : "none"}>
            {inPlace && arrangement.phase === "arranging" ? (
              <p className="working-text map-arranging">Arranging the map of every incident of the parent…</p>
            ) : (
              <ProcessMap
                graph={graph}
                positions={positions}
                layout={mapLayout}
                abstraction={ranked}
                onAbstractionChange={changeDetail}
                view={view}
                onViewChange={setView}
                // Drawn on the Canvas from the same number of elements as the detail controls reckon with.
                canvasThreshold={CANVAS_FROM}
                // Drawn as elements, the map draws every path its detail selects, which is what the controls above it say.
                edgeBudget={controlsAbove ? "all" : "adaptive"}
                activityLabels={activityLabels}
                theme={MAP_THEME}
                // The chosen measure, with what is laid over the library's style of it.
                {...asked}
                // Listening for the choice is what makes the map's whole legend offer the measures.
                onMeasureChange={setMeasure}
                // Arranged anew, the map is fitted each time. In place, the map of the whole parent is fitted
                // and a selection keeps that view, so nothing moves on screen.
                fitView={inPlace ? shown.steps.length === 0 : true}
                // An activity moved by hand goes back when the map is arranged anew for other content, for other stages or to run the other way.
                layoutResetKey={`${inPlace ? "in-place" : `${shown.revision}:${detail?.activityDetail ?? 1}:${detail?.pathDetail ?? 1}`}:${stagesRevision}:${direction}`}
                // Names are drawn from a smaller zoom on than the library's default, so that an overview still names its activities.
                lod={LABELS_FROM}
                // The library's own detail panel inside the map, only where the controls are not above it.
                controls={!controlsAbove}
                legend
                minimap={overview}
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
        )}
      </div>
      {editingStages && (
        <div className="map-stages-panel">
          <div className="map-stages-head">
            <h4 className="pane-title" tabIndex={-1} ref={stagesTitle}>
              Stages of this log
            </h4>
            <IconButton icon="close" label="Close the editor of the stages" onClick={closeStages} />
          </div>
          <StagesEditor reading={reading} parentGraph={parentGraph} />
        </div>
      )}
      {aside !== undefined && (
        <div className="map-aside" hidden={editingStages || element !== null || listed}>
          {aside}
        </div>
      )}
      {/*
        While nothing is selected the section says only what a selection offers. That is kept for assistive
        technology and takes no room on the page; a selected element shows its steps here, beside the map.
      */}
      <section
        className={element === null ? "map-element visually-hidden" : "map-element"}
        aria-labelledby="map-element-title"
        aria-live="polite"
        hidden={editingStages}
      >
        <h4 id="map-element-title" className="pane-title">
          {elementTitle(element)}
        </h4>
        {element === null && (
          <p>
            {listed
              ? "Select a row of the list to keep or remove the incidents through it."
              : "Select an activity or a path on the map, or a row of its table view, to keep or remove the incidents through it."}
          </p>
        )}
        {element?.kind === "several" && <p className="muted">Select one activity or one path; a step is taken from one of them.</p>}
        {listed && element?.kind === "path" && onShowMap && (
          <p>
            <button type="button" onClick={() => drawPath(selection.edges[0])}>
              {selectedPathDrawn ? "Show on the map" : "Draw on the map"}
            </button>{" "}
            <span className="muted">
              {selectedPathDrawn
                ? "The map draws this path at its detail."
                : "The detail leaves this path out; drawing it adds it with both its activities. The incidents and the steps stay as they are."}
            </span>
          </p>
        )}
        {element?.kind === "activity" && (
          <ActivityTimesCard graph={shown.graph} nodeId={element.id} onSelectPath={(id) => setSelection({ nodes: [], edges: [id], groups: [] })} />
        )}
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
            {choices.map((choice, index) => {
              const previewId = `step-preview-${index}`;
              const describedBy = [waitingFor, previewStep && !waitingFor ? previewId : undefined].filter(Boolean).join(" ") || undefined;
              return (
                <div key={choice.label} className="map-choice">
                  <button type="button" disabled={waitingFor !== undefined} aria-describedby={describedBy} onClick={() => onStep(choice.step)}>
                    {choice.label}
                  </button>
                  {previewStep && !waitingFor && <StepPreviewLine id={previewId} step={choice.step} previewer={previewStep} />}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
