import { useEffect, useId, useState } from "react";
import type { ImportedPopulationAnswer } from "../generated/imports";
import type { AnswerIdentity, SelectionPredicate } from "../generated/selection";
import type { CaseListRequest } from "../generated/case-list";
import type { ViewState } from "../imported/coordinator";
import type { OpeningContextAnswer } from "../views/messages";
import type { StepPreviewer } from "../map/StepPreviewLine";
import { Filters, type RecordedRange } from "./Filters";
import { NumberRange } from "../numbers/NumberRange";
import { answersCaseList, httpCaseListClient, type CaseListClient } from "./client";

interface Props {
  population: ImportedPopulationAnswer;
  parentIds: readonly string[] | null;
  parentIdentity: AnswerIdentity;
  /** The kept incidents shown: the numbers of a context column are counted for them in the parent's bins. */
  keptIdentity?: AnswerIdentity;
  revision: number;
  opening: ViewState<OpeningContextAnswer>;
  onStep: (step: SelectionPredicate) => void;
  previewStep?: StepPreviewer;
  waitingFor?: string;
  client?: CaseListClient;
}
type RangeState = { phase: "loading" } | { phase: "ready"; range: RecordedRange | null } | { phase: "failed"; message: string };

/** Loads the fixed parent's recorded range, without selecting or reading individual histories. */
export function FilterPanel({ population, parentIds, parentIdentity, keptIdentity, revision, opening, onStep, previewStep, waitingFor, client = httpCaseListClient }: Props) {
  const requestName = useId();
  const [range, setRange] = useState<RangeState>({ phase: "loading" });
  const [retry, setRetry] = useState(0);
  const identityKey = JSON.stringify(parentIdentity);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const request: CaseListRequest = {
      schema_version: 1, message_type: "case_list_request", request_id: `range-${requestName}-${retry}`,
      query_revision: revision, workspace_id: population.workspace_id, identity: parentIdentity,
      query: { search_text: null, sort: { field: "case_id", direction: "ascending" }, offset: 0, limit: 1 },
    };
    setRange({ phase: "loading" });
    client.list(request, controller.signal).then((outcome) => {
      if (!current) return;
      if (outcome.ok && !answersCaseList(request, outcome.answer)) {
        setRange({ phase: "failed", message: "The range answers another question. Retry it or reopen the investigation." });
      } else if (outcome.ok) {
        const clock = population.preparation.policies.time.id === "incident.time.wall_clock_as_recorded.v1" ? "wall_clock" : "utc_instant";
        const recorded = outcome.answer.parent_time_range;
        setRange(recorded !== null && recorded.timestamp_kind !== clock
          ? { phase: "failed", message: "The range uses a different clock. Reopen the investigation before filtering a period." }
          : { phase: "ready", range: recorded });
      } else {
        setRange({ phase: "failed", message: outcome.problem.kind === "refusal" ? outcome.problem.refusal.message : "The recorded range could not be read. Retry it or reopen the investigation." });
      }
    }, () => { if (current) setRange({ phase: "failed", message: "The recorded range could not be read. Retry it or reopen the investigation." }); });
    return () => { current = false; controller.abort(); };
  }, [client, identityKey, population.workspace_id, revision, retry, requestName]);

  return <>
    {range.phase === "failed" && <div role="alert" className="inline-error"><p>{range.message}</p><button type="button" onClick={() => setRetry((value) => value + 1)} disabled={waitingFor !== undefined}>Retry recorded range</button></div>}
    <Filters key={identityKey} population={population} parentIds={parentIds} opening={opening} onStep={onStep} previewStep={previewStep}
      range={range.phase === "ready" ? range.range : undefined}
      rangeProblem={range.phase === "ready" && range.range === null ? "No usable recorded timestamps in this parent." : range.phase === "failed" ? range.message : undefined}
      waitingFor={waitingFor} />
    <NumberRange population={population} identity={keptIdentity ?? parentIdentity} revision={revision} onStep={onStep} previewStep={previewStep} waitingFor={waitingFor}
      columnName={(index) => (opening.phase === "ready" ? opening.answer.opening_context.columns.find((item) => item.column_index === index)?.column_name : undefined) || `Column ${index}`} />
  </>;
}
