import type { ImportProblem } from "./client";
import { describeImportProblem } from "./wording";

interface ImportProblemNoticeProps {
  title: string;
  problem: ImportProblem;
  /** Offered when sending the same request again can help. */
  onRetry?: () => void;
}

/** A refused or failed request: what happened, what to do about it, and a retry where it helps. */
export function ImportProblemNotice({ title, problem, onRetry }: ImportProblemNoticeProps) {
  const text = describeImportProblem(problem);
  const retryable = problem.kind !== "refusal" || problem.refusal.retryable;
  return (
    <div className="inline-error" role="alert">
      <p className="inline-error-title">{title}</p>
      <p>{text.message}</p>
      <p>
        <span className="label-text">What to do</span> {text.remedy}
      </p>
      {onRetry && retryable && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
