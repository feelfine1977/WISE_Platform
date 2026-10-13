/**
 * The request that is to replace the answer shown. While it runs, and after it failed, the screen
 * keeps showing the last coherent answer in full, under its own identity, revision and source name;
 * the request asked for stands beside it until it is answered, given up or tried again.
 */
export type Replacement<Asked, Problem> =
  | { phase: "running"; revision: number; asked: Asked }
  | { phase: "failed"; revision: number; asked: Asked; problem: Problem };

/**
 * The one request a coordinator awaits for the answer it shows. Starting another abandons the
 * earlier one; a reply under any other revision is no longer awaited and is dropped, whether it is
 * an answer, a refusal or a failure.
 */
export class AwaitedRequest {
  private awaited: { revision: number; controller: AbortController } | null = null;

  /** Starts awaiting a request under a new revision, abandons the earlier one, and gives its abort signal. */
  start(revision: number): AbortSignal {
    this.abandon();
    const controller = new AbortController();
    this.awaited = { revision, controller };
    return controller.signal;
  }

  /** Takes the reply of a request: true if it is the one awaited, which is then no longer awaited. */
  take(revision: number): boolean {
    if (this.awaited?.revision !== revision) return false;
    this.awaited = null;
    return true;
  }

  abandon(): void {
    this.awaited?.controller.abort();
    this.awaited = null;
  }
}

/** The line shown while a replacement runs, for example "Showing synthetic example S0; opening synthetic example S1 …". */
export function replacementLine(shown: string, asked: string): string {
  return `Showing ${shown}; opening ${asked} …`;
}

/** Why an action on the answer shown waits while its replacement runs. */
export function waitingReason(shown: string, asked: string): string {
  return `Not available while ${asked} is opening: what is shown belongs to ${shown}.`;
}
