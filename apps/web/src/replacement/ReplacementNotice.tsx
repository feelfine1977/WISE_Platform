import { type Replacement, replacementLine, waitingReason } from "./replacement";

/** What a failed replacement says: what happened, what to do, and whether trying again can help. */
export interface ReplacementProblemText {
  message: string;
  remedy: string | null;
  retryable: boolean;
}

interface ReplacementNoticeProps<Asked, Problem> {
  replacement: Replacement<Asked, Problem>;
  /** The name of the answer shown, under its own source; never the name of what was asked. */
  shown: string;
  /** The name of what was asked for. */
  asked: string;
  /** The id of the text that actions waiting for the replacement refer to. */
  reasonId: string;
  describe: (problem: Problem) => ReplacementProblemText;
  onRetry: () => void;
  onStay: () => void;
}

/**
 * Beside the answer shown: the request that is to replace it, while it runs or after it failed.
 * A failure offers to try again or to stay with what is shown.
 */
export function ReplacementNotice<Asked, Problem>({ replacement, shown, asked, reasonId, describe, onRetry, onStay }: ReplacementNoticeProps<Asked, Problem>) {
  if (replacement.phase === "running") {
    return (
      <div className="replacement">
        <p role="status" className="replacement-line">
          {replacementLine(shown, asked)}
        </p>
        <p id={reasonId} className="visually-hidden">
          {waitingReason(shown, asked)}
        </p>
      </div>
    );
  }
  const text = describe(replacement.problem);
  return (
    <div className="inline-error replacement" role="alert">
      <p className="inline-error-title">
        Could not open {asked}; {shown} is still shown.
      </p>
      <p>{text.message}</p>
      {text.remedy !== null && (
        <p>
          <span className="label-text">What to do</span> {text.remedy}
        </p>
      )}
      <div className="replacement-actions">
        {text.retryable && (
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        )}
        <button type="button" onClick={onStay}>
          Stay with {shown}
        </button>
      </div>
    </div>
  );
}
