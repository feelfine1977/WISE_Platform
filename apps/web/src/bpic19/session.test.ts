import { expect, it } from "vitest";
import { Bpic19Session } from "./session";
import { identity, workspaceId } from "../test/imports";
import type { AnswerIdentity, Bpic19PipelineAction } from "../generated/saving";

function child(n: number): AnswerIdentity { return { ...identity, population_id: "population.v1:sha256:" + n.toString(16).padStart(64,"0") }; }
const first = { kind: "case_id_in", case_ids: ["B","C"], negate: false };
const second = { kind: "case_id_in", case_ids: ["C"], negate: false };
function action(at: AnswerIdentity, definition="same-definition"): Bpic19PipelineAction { return { operation:"bpic19_cohorts",identity:at,query:{policy_id:"literal"},definition_id:definition }; }

it("offers immutable retained reviews while excluding dirty unretained current answers", () => {
  const session = new Bpic19Session();
  session.basis(workspaceId, identity, [], identity);
  session.reviewed(action(identity, "retained"));
  session.retain(action(identity, "retained"));
  session.reviewed(action(identity, "current"));
  expect(session.reviewedDeclarations().map(entry => entry.definition_id)).toEqual(["retained", "current"]);
  session.valid("bpic19_cohorts", false);
  expect(session.reviewedDeclarations().map(entry => entry.definition_id)).toEqual(["retained"]);
  expect(session.readyForSave()).toBe(false);
  const offered = session.reviewedDeclarations();
  offered[0].query.policy_id = "caller edit";
  expect(session.reviewedDeclarations()[0].query.policy_id).toBe("literal");
  session.basis(workspaceId, child(1), [first], identity);
  expect(session.reviewedDeclarations().map(entry => entry.definition_id)).toEqual(["retained"]);
});

it("keeps only reviewed current definitions and fences dirty or old-population actions", () => {
  const session = new Bpic19Session();
  session.basis(workspaceId, identity);
  session.valid("bpic19_profile", false);
  expect(session.readyForSave()).toBe(true); // A generic question remains savable before any purchasing review.
  const action = { operation: "bpic19_profile" as const, identity, query: { policy_id: "literal" }, definition_id: "profile-A" };
  session.reviewed(action);
  session.valid("bpic19_profile", false);
  expect(session.readyForSave()).toBe(false);
  expect(session.savedPipeline()).toBeNull();
  session.valid("bpic19_profile", true);
  const exported = session.savedPipeline()!;
  exported.actions[0].query.policy_id = "mutated";
  expect(session.savedPipeline()!.actions[0].query.policy_id).toBe("literal");
  const next = { ...identity, population_id: "population.v1:sha256:" + "f".repeat(64) };
  session.basis(workspaceId, next);
  session.reviewed(action);
  session.valid("bpic19_profile", false, JSON.stringify([workspaceId, identity]));
  expect(session.savedPipeline()).toBeNull();
  expect(session.readyForSave()).toBe(true);
});

it("keeps accepted parent and two-prefix queries with distinct identity, then prunes descendants on Undo/Clear",()=>{
  const session=new Bpic19Session();session.basis(workspaceId,identity,[],identity);session.reviewed(action(identity));
  session.basis(workspaceId,child(1),[first],identity);
  session.valid("bpic19_cohorts",false);
  expect(session.readyForSave()).toBe(false); // Child request pending; parent evidence alone cannot bypass it.
  session.reviewed(action(child(1)));
  session.basis(workspaceId,child(2),[first,second],identity);session.reviewed(action(child(2)));
  const saved=session.savedPipeline()!;
  expect(saved.actions.map(a=>a.selection_prefix_length)).toEqual([null,1,2]);
  expect(saved.actions.map(a=>a.identity.population_id)).toEqual([identity.population_id,child(1).population_id,child(2).population_id]);
  session.basis(workspaceId,child(1),[first],identity);
  expect(session.savedPipeline()!.actions.map(a=>a.selection_prefix_length)).toEqual([null,1]);
  session.valid("bpic19_cohorts",false,JSON.stringify([workspaceId,child(2)]));
  expect(session.readyForSave()).toBe(true);
  session.basis(workspaceId,identity,[],identity);
  expect(session.savedPipeline()!.actions).toHaveLength(1);
  expect(session.savedPipeline()!.actions[0].selection_prefix_length).toBeNull();
});

it("drops nonancestor branches, dirty definitions and foreign preparation/version bindings",()=>{
  const session=new Bpic19Session();session.basis(workspaceId,identity,[],identity);session.reviewed(action(identity));
  session.basis(workspaceId,child(1),[first],identity);session.reviewed(action(child(1)));
  session.basis(workspaceId,child(3),[second],identity);session.reviewed(action(child(3)));
  expect(session.savedPipeline()!.actions.map(a=>a.identity.population_id)).toEqual([identity.population_id,child(3).population_id]);
  session.valid("bpic19_cohorts",false);
  session.basis(workspaceId,child(4),[second,first],identity);
  expect(session.savedPipeline()!.actions.map(a=>a.identity.population_id)).toEqual([identity.population_id]);
  session.basis(workspaceId,{...child(4),implementation_version:"0.2.0"},[],identity);
  expect(session.savedPipeline()).toBeNull();expect(session.readyForSave()).toBe(true);
});

it("restores only positioned server-verified ancestors and preserves exact immutable export while supporting Undo",()=>{
  const session=new Bpic19Session();
  const accepted=[{...action(identity),selection_prefix_length:null},{...action(child(1)),selection_prefix_length:1},{...action(child(2)),selection_prefix_length:2}];
  expect(session.restore(workspaceId,child(2),[first,second],accepted,identity)).toBe(true);
  expect(session.savedPipeline()!.actions).toEqual(accepted);
  accepted[0].query.policy_id="mutated caller data";
  expect(session.savedPipeline()!.actions[0].query.policy_id).toBe("literal");
  const oldScope=JSON.stringify([workspaceId,child(2)]);
  session.basis(workspaceId,child(1),[first],identity);
  expect(session.savedPipeline()!.actions).toHaveLength(2);
  session.valid("bpic19_cohorts",false,oldScope);expect(session.readyForSave()).toBe(true);
  expect(session.restore(workspaceId,child(1),[first],[{...action(child(1)),selection_prefix_length:100}],identity)).toBe(false);
  expect(session.restore(workspaceId,child(1),[first],[{...action({...identity,source_id:"source.v1:sha256:"+"f".repeat(64)}),selection_prefix_length:null}],identity)).toBe(false);
});

it("blocks an over-limit pipeline without truncating accepted lineage and becomes savable after Undo",()=>{
  const session=new Bpic19Session();const steps: unknown[]=[];
  session.basis(workspaceId,identity,steps,identity);session.reviewed(action(identity));
  for(let i=1;i<=32;i++) { steps.push({kind:"contains_activity",activity:`literal-${i}`,negate:false});session.basis(workspaceId,child(i),steps,identity);session.reviewed(action(child(i))); }
  expect(session.readyForSave()).toBe(false);expect(session.savedPipeline()).toBeNull();
  session.basis(workspaceId,child(31),steps.slice(0,31),identity);
  expect(session.readyForSave()).toBe(true);expect(session.savedPipeline()!.actions).toHaveLength(32);
});

it("preserves every explicitly retained or saved definition when an older same-kind recipe is viewed", () => {
  const session = new Bpic19Session();session.basis(workspaceId,identity,[],identity);
  session.reviewed(action(identity,"first-reviewed"));
  expect(session.retainedActions()).toEqual([]);
  session.retain(action(identity,"first-reviewed"));
  session.retain(action(identity,"second-reviewed"));
  session.reviewed(action(identity,"first-reviewed"));
  expect(session.savedPipeline()!.actions.map(a=>a.definition_id)).toEqual(["second-reviewed","first-reviewed"]);
  const saved=session.savedPipeline()!.actions;
  expect(new Set(saved.map(a=>a.definition_id))).toEqual(new Set(["first-reviewed","second-reviewed"]));
  const fresh=new Bpic19Session();expect(fresh.restore(workspaceId,identity,[],saved,identity)).toBe(true);
  fresh.reviewed(action(identity,"first-reviewed"));
  expect(fresh.retainedActions().map(a=>a.definition_id)).toEqual(["second-reviewed","first-reviewed"]);
  expect(fresh.savedPipeline()!.actions.map(a=>a.definition_id)).toEqual(["second-reviewed","first-reviewed"]);
  expect(fresh.savedPipeline()!.actions).toEqual(saved);
  fresh.retainedActions()[0].query.policy_id="caller mutation";
  expect(fresh.retainedActions()[0].query.policy_id).toBe("literal");
});
