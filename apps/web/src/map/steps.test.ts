import { describe, expect, it } from "vitest";
import { contains, follows } from "../test/selections";
import { canRedo, canUndo, noSteps, redone, undone, withoutStep, withoutSteps, withStep } from "./steps";

const first = contains("Eröffnet");
const second = follows("Eröffnet", "Geschlossen");

describe("the history of the steps of a selection", () => {
  it("adds steps in the order they are taken, and a step already taken only once", () => {
    const once = withStep(noSteps, first);
    const twice = withStep(once, second);
    expect(twice.present).toEqual([first, second]);
    expect(withStep(twice, contains("Eröffnet"))).toBe(twice);
    // The same activity with the other negation is another step.
    expect(withStep(twice, contains("Eröffnet", true)).present).toEqual([first, second, contains("Eröffnet", true)]);
  });

  it("removes one step and keeps the others in their order", () => {
    const three = [first, second, contains("Prüfung", true)].reduce(withStep, noSteps);
    expect(withoutStep(three, second).present).toEqual([first, contains("Prüfung", true)]);
    expect(withoutStep(three, contains("Unbekannt"))).toBe(three);
  });

  it("clears every step, and a selection without steps stays as it is", () => {
    const two = withStep(withStep(noSteps, first), second);
    expect(withoutSteps(two).present).toEqual([]);
    expect(withoutSteps(noSteps)).toBe(noSteps);
  });

  it("undoes and redoes each change, a remove and a clear included", () => {
    const one = withStep(noSteps, first);
    const two = withStep(one, second);
    const removed = withoutStep(two, first);
    const cleared = withoutSteps(removed);
    expect(canUndo(noSteps)).toBe(false);
    expect(canRedo(cleared)).toBe(false);

    const back = undone(cleared);
    expect(back.present).toEqual([second]);
    expect(undone(back).present).toEqual([first, second]);
    expect(undone(undone(undone(back))).present).toEqual([]);
    expect(canUndo(undone(undone(undone(back))))).toBe(false);
    expect(redone(undone(back)).present).toEqual([second]);
    expect(redone(redone(undone(back))).present).toEqual([]);
    expect(redone(cleared)).toBe(cleared);
    expect(undone(noSteps)).toBe(noSteps);
  });

  it("forgets what was undone once another step is taken", () => {
    const back = undone(withStep(withStep(noSteps, first), second));
    expect(canRedo(back)).toBe(true);
    const other = withStep(back, contains("Prüfung"));
    expect(other.present).toEqual([first, contains("Prüfung")]);
    expect(canRedo(other)).toBe(false);
  });
});
