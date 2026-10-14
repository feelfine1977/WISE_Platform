import type { AnswerIdentity, Bpic19Pipeline, Bpic19PipelineAction } from "../generated/saving";
import type { PipelineSource } from "../saved/coordinator";

/** Only current, explicitly reviewed answers may enter the saved pipeline. */
export class Bpic19Session implements PipelineSource {
  private key = "";
  private actions = new Map<Bpic19PipelineAction["operation"], Bpic19PipelineAction>();
  private validity = new Map<Bpic19PipelineAction["operation"], boolean>();

  basis(workspaceId: string, identity: AnswerIdentity): void {
    const next = JSON.stringify([workspaceId, identity]);
    if (next === this.key) return;
    this.key = next;
    this.actions.clear();
    this.validity.clear();
  }

  reviewed(action: Bpic19PipelineAction): void {
    const currentIdentity = JSON.parse(this.key || "[]")[1];
    if (JSON.stringify(currentIdentity) !== JSON.stringify(action.identity)) return;
    this.actions.set(action.operation, structuredClone(action));
    this.validity.set(action.operation, true);
  }

  valid(operation: Bpic19PipelineAction["operation"], value: boolean, scope?: string): void {
    if (scope !== undefined && scope !== this.key) return;
    this.validity.set(operation, value);
  }

  readyForSave(): boolean {
    if (this.actions.size === 0) return true;
    return [...this.validity.values()].every(Boolean);
  }

  savedPipeline(): Bpic19Pipeline | null {
    if (!this.readyForSave() || this.actions.size === 0) return null;
    const ordered = (["bpic19_profile", "bpic19_measures"] as const).flatMap(operation => {
      const action = this.actions.get(operation); return action ? [action] : [];
    });
    return { schema_version: 1, actions: structuredClone(ordered) as Bpic19Pipeline["actions"] };
  }
}
