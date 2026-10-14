import { describe, expect, it } from "vitest";
import { isStageId, moved, nameProblem, noStages, read, renamed, type StageDefinitions, withActivity, withoutStage, withStage, written } from "./definitions";

const names = (definitions: StageDefinitions) => definitions.stages.map((stage) => stage.name);
const three = [" Intake ", "Work  in progress", "Closure"].reduce(withStage, noStages);
const [intake, work, closure] = three.stages.map((stage) => stage.id);

describe("the stages an analyst defines for a log", () => {
  it("adds a named stage after the others and gives it an id of its own", () => {
    expect(noStages).toEqual({ stages: [], assigned: new Map() });
    // A name is taken without the space around it and without runs of space in it.
    expect(names(three)).toEqual(["Intake", "Work in progress", "Closure"]);
    expect(new Set(three.stages.map((stage) => stage.id)).size).toBe(3);
    expect(three.stages.every((stage) => isStageId(stage.id))).toBe(true);
    // The definitions given are not changed.
    expect(noStages.stages).toEqual([]);
  });

  it("gives no stage an empty name or the name of another stage", () => {
    expect(nameProblem(three, "   ")).toBe("empty");
    expect(nameProblem(three, "intake")).toBe("taken");
    expect(nameProblem(three, "Review")).toBeNull();
    expect(withStage(three, "")).toBe(three);
    expect(withStage(three, " CLOSURE ")).toBe(three);

    // A stage may keep its own name, in other letters too; it may not take another's.
    expect(nameProblem(three, "INTAKE", intake)).toBeNull();
    expect(nameProblem(three, "Closure", intake)).toBe("taken");
    expect(renamed(three, intake, "Closure")).toBe(three);
    expect(renamed(three, intake, " ")).toBe(three);
    expect(renamed(three, intake, "Intake")).toBe(three);
    expect(renamed(three, "stage:99", "Review")).toBe(three);
  });

  it("renames a stage in its place, with its id and its activities", () => {
    const assigned = withActivity(three, "Eröffnet", intake);
    const after = renamed(assigned, intake, "  Customer side ");
    expect(names(after)).toEqual(["Customer side", "Work in progress", "Closure"]);
    expect(after.stages[0].id).toBe(intake);
    expect(after.assigned.get("Eröffnet")).toBe(intake);
    expect(names(assigned)).toEqual(["Intake", "Work in progress", "Closure"]);
  });

  it("moves a stage one place earlier or later, and no further than the ends", () => {
    expect(names(moved(three, closure, "earlier"))).toEqual(["Intake", "Closure", "Work in progress"]);
    expect(names(moved(three, intake, "later"))).toEqual(["Work in progress", "Intake", "Closure"]);
    expect(moved(three, intake, "earlier")).toBe(three);
    expect(moved(three, closure, "later")).toBe(three);
    expect(moved(three, "stage:99", "later")).toBe(three);
    // The stage of an activity stays its stage wherever the stage stands.
    const assigned = withActivity(three, "Geschlossen", closure);
    expect(moved(assigned, closure, "earlier").assigned).toEqual(new Map([["Geschlossen", closure]]));
  });

  it("puts an activity into one stage or into none", () => {
    const one = withActivity(three, "Eröffnet", intake);
    expect(one.assigned).toEqual(new Map([["Eröffnet", intake]]));
    // An activity is in one stage: another stage takes it over.
    const other = withActivity(one, "Eröffnet", work);
    expect(other.assigned).toEqual(new Map([["Eröffnet", work]]));
    expect(withActivity(other, "Eröffnet", null).assigned).toEqual(new Map());
    // Nothing changes where nothing is asked for, or a stage is not defined.
    expect(withActivity(one, "Eröffnet", intake)).toBe(one);
    expect(withActivity(one, "Prüfung", null)).toBe(one);
    expect(withActivity(one, "Prüfung", "stage:99")).toBe(one);
    expect(three.assigned.size).toBe(0);
  });

  it("removes a stage and leaves its activities in no stage", () => {
    const assigned = withActivity(withActivity(three, "Eröffnet", intake), "Geschlossen", closure);
    const after = withoutStage(assigned, intake);
    expect(names(after)).toEqual(["Work in progress", "Closure"]);
    expect(after.assigned).toEqual(new Map([["Geschlossen", closure]]));
    expect(withoutStage(assigned, "stage:99")).toBe(assigned);
    // A stage added afterwards does not take the id of one that is still there.
    const again = withStage(after, "Review");
    expect(new Set(again.stages.map((stage) => stage.id)).size).toBe(3);
  });

  it("takes an activity of any name, also one that names something every object has", () => {
    const odd = ["constructor", "__proto__", "toString", ""].reduce((definitions, activity) => withActivity(definitions, activity, work), three);
    expect([...odd.assigned.keys()]).toEqual(["constructor", "__proto__", "toString", ""]);
    expect(three.assigned.get("constructor")).toBeUndefined();
    expect(read(JSON.parse(JSON.stringify(written(odd))))).toEqual(odd);
  });
});

describe("the stages as they are kept and read again", () => {
  it("reads what was written", () => {
    const assigned = withActivity(withActivity(three, "Eröffnet", intake), "Geschlossen", closure);
    const kept: unknown = JSON.parse(JSON.stringify(written(assigned)));
    expect(kept).toEqual({
      stages: [
        { id: intake, name: "Intake" },
        { id: work, name: "Work in progress" },
        { id: closure, name: "Closure" },
      ],
      assigned: [
        ["Eröffnet", intake],
        ["Geschlossen", closure],
      ],
    });
    expect(read(kept)).toEqual(assigned);
    expect(read(JSON.parse(JSON.stringify(written(noStages))))).toBe(noStages);
  });

  it("gives no stage for anything that is not of the written form", () => {
    for (const kept of [null, undefined, 7, "stages", [], {}, { stages: "Intake" }, { stages: [] }, { assigned: [["Eröffnet", "stage:1"]] }]) {
      expect(read(kept), JSON.stringify(kept)).toBe(noStages);
    }
  });

  it("leaves out a stage or an activity that is not as it was written, and keeps the rest", () => {
    const kept = {
      stages: [
        { id: "stage:1", name: " Intake " },
        null,
        "Closure",
        { id: "stage:2" },
        { id: "stage:3", name: "   " },
        { id: 4, name: "Four" },
        // An id that is not a stage's could name an activity or an event of the map.
        { id: "event:start", name: "Start" },
        { id: "__proto__", name: "Any" },
        { id: "stage:01", name: "Padded" },
        { id: "stage:1", name: "Intake again" },
        { id: "stage:5", name: "Closure" },
      ],
      assigned: [
        ["Eröffnet", "stage:1"],
        ["Geschlossen", "stage:5"],
        ["Prüfung", "stage:3"],
        ["Prüfung", "event:start"],
        ["Eröffnet"],
        [7, "stage:1"],
        "Eröffnet",
        null,
      ],
    };
    expect(read(kept)).toEqual({
      stages: [
        { id: "stage:1", name: "Intake" },
        { id: "stage:5", name: "Closure" },
      ],
      assigned: new Map([
        ["Eröffnet", "stage:1"],
        ["Geschlossen", "stage:5"],
      ]),
    });
    // A stage added to what was read does not take an id that is in use.
    expect(withStage(read(kept), "Review").stages[2].id).toBe("stage:6");
    expect(read({ stages: [{ id: "stage:1", name: "Intake" }], assigned: { Eröffnet: "stage:1" } }).assigned.size).toBe(0);
  });

  it("takes no stage from a damaged store whose id is too large to count on from", () => {
    // Beyond fifteen digits the number after an id is no longer told apart from it, and a far longer one is no number at all.
    const tooLarge = read({ stages: [{ id: "stage:9007199254740992", name: "Existing" }, { id: "stage:7", name: "Kept" }], assigned: [] });
    expect(tooLarge.stages.map((stage) => stage.id)).toEqual(["stage:7"]);
    const overflowing = read({ stages: [{ id: `stage:${"9".repeat(400)}`, name: "Existing" }], assigned: [] });
    expect(overflowing.stages).toEqual([]);
    for (const loaded of [tooLarge, overflowing]) {
      const after = withStage(loaded, "Added");
      expect(new Set(after.stages.map((stage) => stage.id)).size).toBe(after.stages.length);
      expect(after.stages.every((stage) => isStageId(stage.id))).toBe(true);
    }
    // After the largest id that is taken as one, a new stage gets the smallest free id, which is one too.
    expect(isStageId("stage:999999999999999")).toBe(true);
    expect(isStageId("stage:1000000000000000")).toBe(false);
    const last = read({ stages: [{ id: "stage:999999999999999", name: "Last" }, { id: "stage:1", name: "First" }], assigned: [] });
    expect(withStage(last, "Added").stages.map((stage) => stage.id)).toEqual(["stage:999999999999999", "stage:1", "stage:2"]);
  });
});
