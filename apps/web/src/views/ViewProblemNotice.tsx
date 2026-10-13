import type { ViewProblem } from "./client";
import { describeViewProblem } from "./wording";

interface ViewProblemNoticeProps {
  title: string;
  problem: ViewProblem;
  onRetry: () => void;
}

/** A refused or failed view of the population: what happened, what to do, and a retry where it helps. */
export function ViewProblemNotice({ title, problem, onRetry }: ViewProblemNoticeProps) {
  const text = describeViewProblem(problem);
  const retryable = problem.kind !== "refusal" || problem.refusal.retryable;
  return (
    <div className="inline-error" role="alert">
      <p className="inline-error-title">{title}</p>
      <p>{text.message}</p>
      <p>
        <span className="label-text">What to do</span> {text.remedy}
      </p>
      {retryable && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
