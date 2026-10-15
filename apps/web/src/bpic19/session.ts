import type { AnswerIdentity, Bpic19Pipeline, Bpic19PipelineAction, Bpic19LiteratureClaim } from "../generated/saving";
import type { PipelineSource } from "../saved/coordinator";
import { sameJson } from "../data/coordinator";

const operations = ["bpic19_profile", "bpic19_measures", "bpic19_cohorts", "bpic19_score",
  "bpic19_ordinal", "bpic19_fifo", "bpic19_cancellation", "bpic19_rule", "bpic19_waiting", "bpic19_flow_comparison", "bpic19_interval_comparison", "bpic19_operator_comparison", "bpic19_cohort_comparison", "bpic19_method_gate"] as const;
type Reviewed = { action: Bpic19PipelineAction; path: readonly unknown[]; keepPredicate?:unknown };
type HistoryOrigins = { key: string; path: readonly unknown[]; entries: Reviewed[] };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function actionKey(action: Bpic19PipelineAction) { return canonical([action.operation, action.definition_id, action.identity, action.selection_keep ?? null]); }
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
  private pendingKeep: {action:Bpic19PipelineAction;path:readonly unknown[];predicate:unknown} | undefined;
  private historyNode: readonly unknown[] | undefined;
  private historyOrigins = new WeakMap<readonly unknown[], HistoryOrigins>();

  /** A failed/cancelled selection cannot later lend its origin to equal-member IDs. */
  discardPendingKeep():void {this.pendingKeep=undefined;}

  /** Capture meaning before selection; publish it only after that exact child succeeds. */
  recordKeep(action:Bpic19PipelineAction,predicate:unknown):boolean {
    const current=this.actions.get("bpic19_profile"),keep=action.selection_keep;
    const position=current?.selection_prefix_length;
    const exactBase=position===null && this.baseIdentity!==undefined && sameJson(action.identity,this.baseIdentity);
    if(!current || this.validity.get("bpic19_profile")!==true || !keep || this.path===undefined ||
      this.path.some(step=>sameJson(step,predicate)) ||
      keep.step_index!==this.path.length || action.selection_prefix_length!==position ||
      !(position===this.path.length || exactBase && this.path.length===0) ||
      !sameJson(action.identity,current.identity) || action.definition_id!==current.definition_id ||
      !sameJson(action.query,current.query))return false;
    this.pendingKeep={action:structuredClone(action),path:structuredClone(this.path),predicate:structuredClone(predicate)};
    return true;
  }

  basis(workspaceId: string, identity: AnswerIdentity, predicates?: readonly unknown[], baseIdentity?: AnswerIdentity): void {
    const next = JSON.stringify([workspaceId, identity]);
    if (next === this.key && sameJson(predicates, this.path) && predicates === this.historyNode) {
      if (baseIdentity !== undefined) this.baseIdentity = structuredClone(baseIdentity);
      return;
    }
    const nextBinding = binding(workspaceId, identity);
    if (this.binding === nextBinding && predicates !== undefined && this.path !== undefined) {
      // Undo/Redo reuses the coordinator's immutable history arrays. A fresh
      // manual branch gets a new node even when every predicate is equal.
      if (this.historyNode) this.historyOrigins.set(this.historyNode, {
        key: this.key, path: structuredClone(this.path),
        entries: structuredClone([...new Map(this.ancestors.filter(entry => entry.action.selection_keep)
          .map(entry => [actionKey(entry.action), entry])).values()]),
      });
      const restoredOrigins = this.historyOrigins.get(predicates);
      const pending=this.pendingKeep;
      if(pending && prefix(pending.path,predicates) && predicates.length>pending.path.length &&
        sameJson(predicates[pending.path.length],pending.predicate))this.ancestors.push({action:pending.action,path:pending.path,keepPredicate:pending.predicate});
      this.ancestors = this.ancestors.filter(entry => prefix(entry.path, predicates));
      this.ancestors=this.ancestors.map(entry=>{
        const keep=entry.action.selection_keep;
        if(!keep || (keep.step_index< predicates.length && sameJson(entry.keepPredicate,predicates[keep.step_index])))return entry;
        const {selection_keep:_association,...ordinary}=entry.action;
        return {...entry,action:ordinary};
      });
      if (prefix(this.path, predicates)) {
        for (const [operation, action] of this.actions) {
          if (this.validity.get(operation) === true) this.ancestors.push({ action: structuredClone(action), path: structuredClone(this.path),
            ...(action.selection_keep?{keepPredicate:structuredClone(this.path[action.selection_keep.step_index])}:{}) });
        }
      }
      if (restoredOrigins?.key === next && sameJson(restoredOrigins.path, predicates)) {
        const retained = new Set(this.ancestors.map(entry => actionKey(entry.action)));
        for (const entry of restoredOrigins.entries) if (!retained.has(actionKey(entry.action))) {
          this.ancestors.push(structuredClone(entry)); retained.add(actionKey(entry.action));
        }
      }
    } else {
      this.ancestors = []; this.replayMode = undefined;this.literatureClaims=[];this.literatureDraftCurrent=true;
      this.historyOrigins = new WeakMap();
    }
    this.key = next;
    this.pendingKeep=undefined;
    this.binding = nextBinding;
    this.baseIdentity = baseIdentity === undefined ? undefined : structuredClone(baseIdentity);
    this.path = predicates === undefined ? undefined : structuredClone(predicates);
    this.historyNode = predicates;
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
    this.pendingKeep=undefined;
    this.historyNode=undefined;
    this.historyOrigins=new WeakMap();
    this.basis(workspaceId, identity, predicates, baseIdentity);
    this.replayMode = replayMode;
    this.setClaims(literatureClaims);
    const accepted: Reviewed[] = [];
    for (const action of actions) {
      if (binding(workspaceId, action.identity) !== this.binding) return false;
      const length = action.selection_prefix_length;
      const keep=action.selection_keep;
      if(keep && (action.operation!=="bpic19_profile" ||
        !(length===keep.step_index || length===null && keep.step_index===0 && sameJson(action.identity,this.baseIdentity)) ||
        typeof length==="number" && sameJson(action.identity,this.baseIdentity) ||
        keep.step_index>=predicates.length))return false;
      if (length === undefined) {
        // A legacy current answer is usable; an ancestor without a position is not guessed.
        if (sameJson(action.identity, identity)) accepted.push({ action: structuredClone(action), path: structuredClone(predicates) });
        continue;
      }
      if (length === null) {
        if (this.baseIdentity !== undefined && !sameJson(action.identity, this.baseIdentity)) return false;
        accepted.push({ action: structuredClone(action), path: [],
          ...(keep?{keepPredicate:structuredClone(predicates[keep.step_index])}:{}) });
      } else {
        if (!Number.isInteger(length) || length < 0 || length > Math.min(100, predicates.length)) return false;
        accepted.push({ action: structuredClone(action), path: structuredClone(predicates.slice(0, length)),
          ...(keep?{keepPredicate:structuredClone(predicates[keep.step_index])}:{}) });
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
    if(this.pendingKeep)return false;
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
      if (action && (!reviewedCurrentOnly || this.validity.get(operation) === true)) {
        const key = actionKey(action);
        const retainedAtKey = unique.get(key);
        const latestAtPosition = [...unique.values()].filter(previous =>
          previous.operation === operation && sameJson(previous.identity, action.identity) &&
          previous.selection_prefix_length === action.selection_prefix_length).at(-1);
        // Map.set keeps a retained recipe's first insertion position. A return
        // to that recipe is a new current review only in this exact context.
        // A new prefix can have the same canonical population and ordinary key.
        // Keep the backend's one ordinary key, but publish its current position.
        // An unchanged reread must preserve the frozen declaration order.
        if (!action.selection_keep && (
          retainedAtKey && retainedAtKey.selection_prefix_length !== action.selection_prefix_length ||
          latestAtPosition && actionKey(latestAtPosition) !== key)) unique.delete(key);
        unique.set(key, action);
      }
    }
    const all=[...unique.values()];
    const baseKey=(action:Bpic19PipelineAction)=>canonical([action.operation,action.definition_id,action.identity,action.query]);
    const associated=all.filter(action=>action.selection_keep);
    // Equal membership does not make an ancestor origin the current recipe.
    // Legacy, source-base null and numeric positions remain distinct.
    return all.filter(action=>action.selection_keep || !associated.some(typed=>
      typed.selection_prefix_length===action.selection_prefix_length && baseKey(typed)===baseKey(action)));
  }

  savedPipeline(): Bpic19Pipeline | null {
    if (!this.readyForSave()) return null;
    const ordered = this.orderedActions(); if (ordered.length === 0) return null;
    return { schema_version: 1, actions: structuredClone(ordered) as Bpic19Pipeline["actions"],
      ...(this.literatureClaims.length?{literature_claims:this.claims()}:{}),
      ...(this.replayMode === undefined ? {} : { replay_mode: this.replayMode }) };
  }
}
