import type { ImportProblem } from "../data/client";
import type { DataCoordinator, DataState } from "../data/coordinator";
import { type WorkspaceExample, workspaceExamples } from "../data/examples";
import type { PreparationId, WorkspaceId } from "../generated/imports";
import type { SelectionPredicate } from "../generated/selection";
import type { PreparationTarget } from "../imported/coordinator";

/** The packaged example an empty workspace of the application is started with. */
export const startExample: WorkspaceExample = workspaceExamples[0];

/**
 * What the start of the application is doing until an investigation is shown: opening the
 * application's own workspace, reading the packaged example into an empty one, or done. It is done
 * as soon as a reading was opened, and also as soon as the analyst chose a workspace or a source.
 */
export type StartState =
  | { phase: "idle" }
  | { phase: "workspace" }
  | { phase: "example" }
  | { phase: "done" }
  | { phase: "failed"; step: "workspace" | "example"; problem: ImportProblem | null };

/** A reading as it was left: which one, and the steps its incidents were selected by. */
export interface LeftReading {
  preparationId: PreparationId;
  steps: readonly SelectionPredicate[];
}

/**
 * Which reading of a workspace was shown last on this computer and with which steps, so that a
 * refresh and a restart take the work up where it was left. A convenience, never an identity: what
 * is recalled is used only when the workspace lists the reading, and the local service selects the
 * incidents of the steps anew.
 */
export interface ReadingMemory {
  remember(target: PreparationTarget, steps?: readonly SelectionPredicate[]): void;
  recall(workspaceId: WorkspaceId): LeftReading | null;
}

const memoryKey = "wise-platform.last-reading";

/** Kept in the browser's local storage; where that is not available, nothing is remembered. */
export const browserReadingMemory: ReadingMemory = {
  remember(target, steps = []) {
    try {
      window.localStorage.setItem(memoryKey, JSON.stringify({ workspaceId: target.workspaceId, preparationId: target.preparationId, steps }));
    } catch {
      // Remembering is a convenience; the start then opens the latest reading of the workspace.
    }
  },
  recall(workspaceId) {
    try {
      const kept: unknown = JSON.parse(window.localStorage.getItem(memoryKey) ?? "null");
      if (typeof kept !== "object" || kept === null) return null;
      const { workspaceId: keptWorkspace, preparationId, steps } = kept as Record<string, unknown>;
      if (keptWorkspace !== workspaceId || typeof preparationId !== "string") return null;
      return { preparationId, steps: Array.isArray(steps) ? (steps as SelectionPredicate[]) : [] };
    } catch {
      return null;
    }
  },
};

/**
 * Brings the application from its start to an investigation without a question to the analyst:
 * it opens the application's own workspace, then the reading used last in it, or, in a workspace
 * without a reading, stores the packaged example like any source and opens its incidents. A
 * remembered reading is used only when the workspace lists it.
 *
 * It follows the Data area's state and steps aside for good once the analyst chooses another
 * workspace or any source there, whatever the source's file is called. Stopped before it was done,
 * it decides again from what the workspace holds when it is started anew.
 */
export class FirstOpen {
  private state: StartState = { phase: "idle" };
  private workspaceId: WorkspaceId | null = null;
  /** The number of the example load this start asked for; a source of any other origin is the analyst's. */
  private exampleLoad: number | null = null;
  /** True while the example load is being asked for, before its number is known here. */
  private asking = false;
  /** The step this start was stopped in, until it is started anew. */
  private stoppedIn: "workspace" | "example" | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly data: DataCoordinator,
    private readonly open: (target: PreparationTarget, steps: readonly SelectionPredicate[]) => void,
    private readonly memory: ReadingMemory = browserReadingMemory,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): StartState => this.state;

  start(): void {
    if (this.unsubscribe !== null) return;
    this.unsubscribe = this.data.subscribe(this.follow);
    if (this.state.phase !== "idle") {
      this.follow();
      return;
    }
    const stoppedIn = this.stoppedIn;
    this.stoppedIn = null;
    const data = this.data.getState();
    const { workspace } = data;
    // A request for the application's own workspace that was abandoned before its reply is sent again.
    if (workspace.phase === "none" || (workspace.phase === "opening" && workspace.path === null)) {
      this.openWorkspace();
      return;
    }
    // Stopped while its own request was out: the request may have been abandoned or answered meanwhile,
    // so the step is decided again from the workspace as it is now.
    const stillItsExample =
      stoppedIn === "example" &&
      workspace.phase === "open" &&
      workspace.answer.workspace_id === this.workspaceId &&
      data.exampleLoad === this.exampleLoad;
    if (stoppedIn === "workspace" || stillItsExample) {
      this.state = { phase: "workspace" };
      this.followWorkspace(data);
    } else {
      this.publish({ phase: "done" });
    }
  }

  /** Stops following; a start that was not done yet goes on from the workspace's state when started anew. */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.state.phase === "workspace" || this.state.phase === "example") {
      this.stoppedIn = this.state.phase;
      this.state = { phase: "idle" };
    }
  }

  /** Sends the failed step again. */
  retry(): void {
    if (this.state.phase !== "failed") return;
    if (this.state.step === "workspace") this.openWorkspace();
    else this.loadExample();
  }

  private openWorkspace(): void {
    this.publish({ phase: "workspace" });
    this.data.openDefaultWorkspace();
  }

  private loadExample(): void {
    this.publish({ phase: "example" });
    this.asking = true;
    this.exampleLoad = this.data.loadExample(startExample);
    this.asking = false;
    this.follow();
  }

  private follow = (): void => {
    if (this.asking) return;
    const data = this.data.getState();
    if (this.state.phase === "workspace") this.followWorkspace(data);
    else if (this.state.phase === "example") this.followExample(data);
  };

  private followWorkspace({ workspace, sources, preparations }: DataState): void {
    if (workspace.phase === "none") {
      // The analyst stopped waiting for the workspace.
      this.publish({ phase: "done" });
    } else if (workspace.phase === "opening" || workspace.phase === "failed") {
      if (workspace.path !== null) this.publish({ phase: "done" });
      else if (workspace.phase === "failed") this.publish({ phase: "failed", step: "workspace", problem: workspace.problem });
    } else if (!workspace.own) {
      this.publish({ phase: "done" });
    } else if (preparations.length === 0) {
      this.workspaceId = workspace.answer.workspace_id;
      this.loadExample();
    } else {
      const left = this.memory.recall(workspace.answer.workspace_id);
      const remembered = preparations.find((item) => item.preparation_id === left?.preparationId);
      const reading = remembered ?? preparations[preparations.length - 1];
      this.publish({ phase: "done" });
      this.open(
        {
          workspaceId: workspace.answer.workspace_id,
          preparationId: reading.preparation_id,
          sourceName: sources.find((item) => item.source_id === reading.source_id)?.filename,
        },
        // The steps belong to the reading they were made on; another reading opens without them.
        remembered && left ? left.steps : [],
      );
    }
  }

  private followExample({ workspace, source, inspection, interpretation, exampleLoad }: DataState): void {
    // Another workspace, a source of another origin, or none after the analyst stopped waiting: the analyst has taken over.
    if (workspace.phase !== "open" || workspace.answer.workspace_id !== this.workspaceId || exampleLoad === null || exampleLoad !== this.exampleLoad) {
      this.publish({ phase: "done" });
    } else if (source.phase === "failed") {
      this.publish({ phase: "failed", step: "example", problem: source.problem });
    } else if (inspection.phase === "failed") {
      this.publish({ phase: "failed", step: "example", problem: inspection.problem });
    } else if (interpretation.phase === "failed") {
      this.publish({ phase: "failed", step: "example", problem: interpretation.problem });
    } else if (interpretation.phase === "answered") {
      const preparation = interpretation.answer.preparation;
      if (preparation === null) {
        // The example was read but waits for a confirmation in the Data area.
        this.publish({ phase: "failed", step: "example", problem: null });
      } else {
        this.publish({ phase: "done" });
        this.open({ workspaceId: workspace.answer.workspace_id, preparationId: preparation.preparation_id, sourceName: startExample.filename }, []);
      }
    }
  }

  private publish(state: StartState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
