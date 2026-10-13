import type { AbstractOptions } from "wise-flow";
import { AbstractionControls } from "wise-flow/react";
import "./canvas.css";
import { type MapDetail, statementAsText } from "./detail";

interface DetailStripProps {
  /** The detail the map is given. */
  detail: AbstractOptions;
  /** What the map draws at that detail. */
  shown: MapDetail;
  onChange: (detail: AbstractOptions) => void;
  /** Whether the map is shown as the map library's table; without `onViewChange` the strip offers no switch. */
  view?: "map" | "table";
  onViewChange?: (view: "map" | "table") => void;
}

/**
 * The detail controls of the map in a strip above its canvas, so that the canvas is the map's
 * alone: the map library's own two sliders, each with the statement of what is shown, and its
 * switch to the table view. The sliders stand where the map's detail stands and the statements are
 * those of the graph the map draws (`mapDetail`). When moving one slider changes the statement of
 * the other, the controls say it in a live region of their own.
 */
export function DetailStrip({ detail, shown, onChange, view, onViewChange }: DetailStripProps) {
  return (
    <div className="map-detail">
      <AbstractionControls
        value={detail}
        onChange={onChange}
        locale="en"
        hasStages={shown.hasStages}
        view={view}
        onViewChange={onViewChange}
        positions={shown.positions}
        statement={statementAsText(shown.statement)}
      />
    </div>
  );
}
