import { describeImportProblem } from "../data/wording";
import type { ImportedInvestigationState } from "../imported/coordinator";
import { describeSelectionProblem } from "../map/wording";

interface InvestigationPrerequisiteProps {
  state: ImportedInvestigationState;
  /** What the area does with the incidents of the investigation, in one sentence. */
  purpose: string;
  /** Whether the area waits for the selection too, or only for the incidents of the reading. */
  needsSelection: boolean;
  onShowData: () => void;
  onShowInvestigation: () => void;
  onRetryPopulation: () => void;
  onRetrySelection: () => void;
}

/**
 * What an area that works on the incidents of the investigation is waiting for, when they are not there: no reading
 * open, the incidents being opened or selected, or a failure of either, each said in words with an action that works
 * from here. Nothing earlier is claimed as current while waiting, and a failure keeps whatever the area showed before.
 */
export function InvestigationPrerequisite({ state, purpose, needsSelection, onShowData, onShowInvestigation, onRetryPopulation, onRetrySelection }: InvestigationPrerequisiteProps) {
  const { population, selection } = state;
  if (population.phase === "idle") {
    return (
      <div className="area-prerequisite">
        <p>{purpose} No incidents are open at the moment: open the incidents of a reading in the Data area, for example of the packaged example.</p>
        <button type="button" onClick={onShowData}>Go to the Data area</button>
      </div>
    );
  }
  if (population.phase === "loading") {
    return (
      <div className="area-prerequisite">
        <p role="status">{purpose} The incidents of {population.target.sourceName ?? "the reading"} are being opened; this area is ready as soon as they are there.</p>
        <button type="button" onClick={onShowInvestigation}>Show the investigation</button>
      </div>
    );
  }
  if (population.phase === "failed") {
    const text = describeImportProblem(population.problem);
    return (
      <div className="area-prerequisite inline-error" role="alert">
        <p className="inline-error-title">The incidents could not be opened, so this area has nothing to work on.</p>
        <p>{text.message}</p>
        {text.remedy && <p><span className="label-text">What to do</span> {text.remedy}</p>}
        <p>
          <button type="button" onClick={onRetryPopulation}>Try again</button>{" "}
          <button type="button" onClick={onShowData}>Go to the Data area</button>
        </p>
      </div>
    );
  }
  if (needsSelection && selection.phase === "failed" && selection.shown === null) {
    const text = describeSelectionProblem(selection.problem);
    return (
      <div className="area-prerequisite inline-error" role="alert">
        <p className="inline-error-title">The incidents could not be selected, so this area has nothing to work on.</p>
        <p>{text.message}</p>
        <p>
          <button type="button" onClick={onRetrySelection}>Try again</button>{" "}
          <button type="button" onClick={onShowInvestigation}>Show the investigation</button>
        </p>
      </div>
    );
  }
  return (
    <div className="area-prerequisite">
      <p role="status">{purpose} The incidents are being selected; this area is ready as soon as they are.</p>
      <button type="button" onClick={onShowInvestigation}>Show the investigation</button>
    </div>
  );
}
