import type { Measure } from "wise-flow";

interface MeasureSwitchProps {
  measure: Measure;
  onMeasure: (measure: Measure) => void;
}

/** The two measures the switch offers, with their words: the incidents on each path and activity, or the supplied median times. */
const MEASURES: readonly [Measure, string][] = [
  ["frequency", "Incidents"],
  ["performance", "Time"],
];

/**
 * What every number of the map counts, as a switch of two parts at the start of the map's row: the
 * incidents, or the times. It changes every number on the map, so it stands first. The map's own
 * legend offers the same choice; both read and set the one the map view holds.
 */
export function MeasureSwitch({ measure, onMeasure }: MeasureSwitchProps) {
  return (
    <div className="measure-switch" role="group" aria-label="What the map counts">
      {MEASURES.map(([value, label]) => (
        // Named with the map, so that it is told apart from the view of the incidents beside the map.
        <button key={value} type="button" aria-label={`${label} on the map`} aria-pressed={measure === value} onClick={() => onMeasure(value)}>
          {label}
        </button>
      ))}
    </div>
  );
}
