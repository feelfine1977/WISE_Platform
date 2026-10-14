import type { DetailStatement } from "wise-flow";
import flowPackage from "wise-flow/package.json";
import type { SuppliedGraph } from "../generated/selection";
import { coverageRows, mapCaption } from "./wording";

/** The words every flows line begins with. "About this map" says them once, as the heading over all that is not drawn. */
export const NOT_DRAWN = "Not drawn at this detail";

/** A flows line as it reads under that heading: without the words the heading has said. */
export function underNotDrawn(line: string): string {
  return line.startsWith(`${NOT_DRAWN}: `) ? line.slice(NOT_DRAWN.length + 2) : line;
}

interface AboutMapProps {
  /** The supplied graph of the kept incidents: its coverage says what the map counts. */
  graph: SuppliedGraph;
  /** The statements of the detail controls; absent only for a graph the map library did not reduce. */
  statement: DetailStatement | undefined;
  /** What is said while some flows from Start or to End are not drawn; null when all are. */
  flowsNotDrawn: string | null;
}

/**
 * What "About this map" says, in the order an analyst needs it: what the map does not draw at its
 * detail (the two statements of the detail controls in full, and the flows from Start and to End
 * left out), every coverage figure of the map, the sentences that define what its numbers count
 * and its measures, and the state of the map library. Every number is a supplied one or the map
 * library's own.
 */
export function AboutMap({ graph, statement, flowsNotDrawn }: AboutMapProps) {
  return (
    <>
      {(statement !== undefined || flowsNotDrawn !== null) && (
        <section className="popover-section map-not-drawn">
          <h4>{NOT_DRAWN}</h4>
          {statement !== undefined && (
            <>
              <p>{statement.activities.full}</p>
              <p>{statement.paths.full}</p>
            </>
          )}
          {flowsNotDrawn !== null && <p className="map-flows">{underNotDrawn(flowsNotDrawn)}</p>}
        </section>
      )}
      <section className="popover-section map-coverage">
        <h4>What the map counts</h4>
        <dl className="pairs">
          {coverageRows(graph.meta).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="map-caption">
        {mapCaption(graph.meta).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <p className="map-library">
        The map is drawn with an unreleased state of the map library (wise-flow {flowPackage.version}, a local packaging candidate).
      </p>
    </>
  );
}
