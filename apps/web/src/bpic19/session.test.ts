import { expect, it } from "vitest";
import { Bpic19Session } from "./session";
import { identity, workspaceId } from "../test/imports";

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
