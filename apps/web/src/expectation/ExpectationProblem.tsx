import type { ScoringProblem } from "./client";
import { describeScoringProblem } from "./wording";

interface ExpectationProblemProps {
  title: string;
  problem: ScoringProblem;
  /** Offered when sending the same request again can help. */
  onRetry?: () => void;
}

/** A refused or failed request: what happened, what to do about it, and a retry where it helps. */
export function ExpectationProblem({ title, problem, onRetry }: ExpectationProblemProps) {
  const text = describeScoringProblem(problem);
  const retryable = problem.kind !== "refusal" || problem.refusal.retryable;
  return (
    <div className="expectation-problem" role="alert">
      <p className="expectation-problem-title">{title}</p>
      <p>{text.message}</p>
      <p>
        <span className="expectation-label">What to do</span> {text.remedy}
      </p>
      {onRetry && retryable && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
