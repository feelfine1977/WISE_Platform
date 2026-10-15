import type { AnswerIdentity, Bpic19Pipeline, Bpic19PipelineAction, Bpic19LiteratureClaim } from "../generated/saving";
import type { PipelineSource } from "../saved/coordinator";
import { sameJson } from "../data/coordinator";

const operations = ["bpic19_profile", "bpic19_measures", "bpic19_cohorts", "bpic19_score",
  "bpic19_ordinal", "bpic19_fifo", "bpic19_cancellation", "bpic19_rule", "bpic19_waiting", "bpic19_flow_comparison", "bpic19_interval_comparison", "bpic19_operator_comparison", "bpic19_cohort_comparison", "bpic19_method_gate"] as const;
type Reviewed = { action: Bpic19PipelineAction; path: readonly unknown[] };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function actionKey(action: Bpic19PipelineAction) { return canonical([action.operation, action.definition_id, action.identity]); }
function prefix(path: readonly unknown[], current: readonly unknown[]) { return path.length <= current.length && path.every((p,i) => sameJson(p,current[i])); }
function binding(workspaceId: string, identity: AnswerIdentity) {
  const { population_id: _population, ...source } = identity; return canonical([workspaceId, source]);
}

/** Only current, explicitly reviewed answers may enter the saved pipeline. */
export class Bpic19Session implements PipelineSource {
  private key = "";
  private actions = new Map<Bpic19PipelineAction["operation"], Bpic19PipelineAction>();
  private validity = new Map<Bpic19PipelineAction["operation"], boolean>();
  private ancestors: Reviewed[] = [];
  private path: readonly unknown[] | undefined;
  private binding = "";
  private baseIdentity: AnswerIdentity | undefined;
  private replayMode: "require_all" | "partial" | undefined;
  private literatureClaims:Bpic19LiteratureClaim[]=[];
  private literatureDraftCurrent=true;

  basis(workspaceId: string, identity: AnswerIdentity, predicates?: readonly unknown[], baseIdentity?: AnswerIdentity): void {
    const next = JSON.stringify([workspaceId, identity]);
    if (next === this.key && sameJson(predicates, this.path)) {
      if (baseIdentity !== undefined) this.baseIdentity = structuredClone(baseIdentity);
      return;
    }
    const nextBinding = binding(workspaceId, identity);
    if (this.binding === nextBinding && predicates !== undefined && this.path !== undefined) {
      this.ancestors = this.ancestors.filter(entry => prefix(entry.path, predicates));
      if (prefix(this.path, predicates)) {
        for (const [operation, action] of this.actions) {
          if (this.validity.get(operation) === true) this.ancestors.push({ action: structuredClone(action), path: structuredClone(this.path) });
        }
      }
    } else { this.ancestors = []; this.replayMode = undefined;this.literatureClaims=[];this.literatureDraftCurrent=true; }
    this.key = next;
    this.binding = nextBinding;
    this.baseIdentity = baseIdentity === undefined ? undefined : structuredClone(baseIdentity);
    this.path = predicates === undefined ? undefined : structuredClone(predicates);
    this.actions.clear();
    this.validity.clear();
    // Definitions reviewed at the restored ancestor become current again on Undo.
    this.ancestors = this.ancestors.filter(entry => {
      if (sameJson(entry.action.identity, identity) && sameJson(entry.path, this.path)) {
        this.actions.set(entry.action.operation, entry.action); this.validity.set(entry.action.operation, true); return true;
      }
      return true;
    });
  }

  reviewed(action: Bpic19PipelineAction): void {
    const currentIdentity = JSON.parse(this.key || "[]")[1];
    if (JSON.stringify(currentIdentity) !== JSON.stringify(action.identity)) return;
    const tagged = this.path === undefined ? action : { ...action, selection_prefix_length: sameJson(action.identity, this.baseIdentity) ? null : this.path.length };
    this.actions.set(action.operation, structuredClone(tagged));
    this.validity.set(action.operation, true);
  }

  /** Explicitly retain a reviewed definition before choosing another recipe. */
  retain(action: Bpic19PipelineAction): void {
    const currentIdentity = JSON.parse(this.key || "[]")[1];
    if (!sameJson(currentIdentity, action.identity) || this.path === undefined) return;
    this.reviewed(action);
    const tagged = this.actions.get(action.operation);
    if (tagged) this.ancestors.push({ action: structuredClone(tagged), path: structuredClone(this.path) });
  }

  /** Saved or explicitly retained recipes, bound to the exact current population. */
  retainedActions(): Bpic19PipelineAction[] {
    const identity = JSON.parse(this.key || "[]")[1];
    const unique = new Map<string, Bpic19PipelineAction>();
    for (const entry of this.ancestors) {
      if (sameJson(entry.action.identity, identity)) unique.set(actionKey(entry.action), entry.action);
    }
    return structuredClone([...unique.values()]);
  }

  declarations(): Bpic19PipelineAction[] { return structuredClone(this.orderedActions()); }
  /** Immutable retained recipes plus current answers whose displayed query is still reviewed. */
  reviewedDeclarations(): Bpic19PipelineAction[] { return structuredClone(this.orderedActions(true)); }
  claims():Bpic19LiteratureClaim[]{return structuredClone(this.literatureClaims);}
  setClaims(claims:readonly Bpic19LiteratureClaim[]):void{this.literatureClaims=structuredClone([...claims]);this.literatureDraftCurrent=true;}
  validClaims(current:boolean):boolean{const changed=this.literatureDraftCurrent!==current;this.literatureDraftCurrent=current;return changed;}

  setReplayMode(mode: "require_all" | "partial"): void { this.replayMode = mode; }

  replayModeForDisplay(): "require_all" | "partial" { return this.replayMode ?? "require_all"; }

  removeMethodGate(): void {
    this.ancestors = this.ancestors.filter(entry => entry.action.operation !== "bpic19_method_gate");
    this.actions.delete("bpic19_method_gate"); this.validity.delete("bpic19_method_gate");
  }

  valid(operation: Bpic19PipelineAction["operation"], value: boolean, scope?: string): void {
    if (scope !== undefined && scope !== this.key) return;
    this.validity.set(operation, value);
  }

  /** Called once with a successful server-reopened manifest, never unverified local storage. */
  restore(workspaceId: string, identity: AnswerIdentity, predicates: readonly unknown[], actions: readonly Bpic19PipelineAction[], baseIdentity?: AnswerIdentity, replayMode?: "require_all" | "partial",literatureClaims:readonly Bpic19LiteratureClaim[]=[]): boolean {
    this.basis(workspaceId, identity, predicates, baseIdentity);
    this.replayMode = replayMode;
    this.setClaims(literatureClaims);
    const accepted: Reviewed[] = [];
    for (const action of actions) {
      if (binding(workspaceId, action.identity) !== this.binding) return false;
      const length = action.selection_prefix_length;
      if (length === undefined) {
        // A legacy current answer is usable; an ancestor without a position is not guessed.
        if (sameJson(action.identity, identity)) accepted.push({ action: structuredClone(action), path: structuredClone(predicates) });
        continue;
      }
      if (length === null) {
        if (this.baseIdentity !== undefined && !sameJson(action.identity, this.baseIdentity)) return false;
        accepted.push({ action: structuredClone(action), path: [] });
      } else {
        if (!Number.isInteger(length) || length < 0 || length > Math.min(100, predicates.length)) return false;
        accepted.push({ action: structuredClone(action), path: structuredClone(predicates.slice(0, length)) });
      }
    }
    this.actions.clear(); this.ancestors = [];
    for (const entry of accepted) {
      // Every declaration in a server-reopened pipeline is retained. Choosing
      // an older one must not discard the previously displayed saved recipe.
      this.ancestors.push(entry);
      if (sameJson(entry.action.identity, identity)) {
        this.actions.set(entry.action.operation, entry.action);
        if (!this.validity.has(entry.action.operation)) this.validity.set(entry.action.operation, true);
      }
    }
    return true;
  }

  readyForSave(): boolean {
    if(!this.literatureDraftCurrent)return false;
    if (this.actions.size === 0 && this.ancestors.length === 0) return this.literatureClaims.length===0;
    if (this.orderedActions().length > 32) return false;
    if (this.orderedActions().some(action => action.operation === "bpic19_method_gate") && this.replayMode !== "partial") return false;
    return [...this.validity.values()].every(Boolean);
  }

  private orderedActions(reviewedCurrentOnly = false): Bpic19PipelineAction[] {
    const unique = new Map<string, Bpic19PipelineAction>();
    for (const entry of this.ancestors) unique.set(actionKey(entry.action), entry.action);
    for (const operation of operations) {
      const action = this.actions.get(operation);
      if (action && (!reviewedCurrentOnly || this.validity.get(operation) === true)) unique.set(actionKey(action), action);
    }
    return [...unique.values()];
  }

  savedPipeline(): Bpic19Pipeline | null {
    if (!this.readyForSave()) return null;
    const ordered = this.orderedActions(); if (ordered.length === 0) return null;
    return { schema_version: 1, actions: structuredClone(ordered) as Bpic19Pipeline["actions"],
      ...(this.literatureClaims.length?{literature_claims:this.claims()}:{}),
      ...(this.replayMode === undefined ? {} : { replay_mode: this.replayMode }) };
  }
}
