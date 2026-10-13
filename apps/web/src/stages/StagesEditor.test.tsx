import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { SuppliedGraph } from "../generated/selection";
import { earlierPreparationId, preparationId, workspaceId } from "../test/imports";
import { checked, closed, opened, suppliedGraph } from "../test/selections";
import { noStages, type StageDefinitions } from "./definitions";
import { StagesEditor } from "./StagesEditor";
import { type StagedReading, type StageMemory, StageStore } from "./store";

const reading: StagedReading = { workspaceId, preparationId };

/*
 * The parent's map of ../test/selections.ts, with other numbers of incidents so that the order of
 * the list shows: "Geschlossen" in 40 incidents, "Eröffnet" and "Prüfung" in 7 each.
 */
const base = suppliedGraph(["A-1", "B-2"]);
const incidents: Record<string, number> = { [opened]: 7, [closed]: 40, [checked]: 7 };
const parentGraph: SuppliedGraph = { ...base, nodes: base.nodes.map((node) => ({ ...node, metrics: { ...node.metrics, cases: incidents[node.label] } })) };

beforeEach(() => window.localStorage.clear());

function setup(store = new StageStore(), graph = parentGraph) {
  const user = userEvent.setup();
  const view = render(<StagesEditor reading={reading} parentGraph={graph} store={store} />);
  return { user, store, view };
}

const editor = () => screen.getByRole("region", { name: "Stages of this log" });
const stageRows = () => within(screen.getByRole("list", { name: "Stages, the earliest first" })).getAllByRole("listitem");
const stageNames = () => stageRows().map((row) => (within(row).getByRole("textbox") as HTMLInputElement).value);
const newStage = () => screen.getByRole("textbox", { name: "New stage" }) as HTMLInputElement;
const stageOf = (activity: string) => screen.getByRole("combobox", { name: `Stage of “${activity}”` }) as HTMLSelectElement;
const said = () => within(editor()).getByRole("status").textContent;
const names = (definitions: StageDefinitions) => definitions.stages.map((stage) => stage.name);

async function addStages(user: ReturnType<typeof userEvent.setup>, ...stages: string[]) {
  for (const name of stages) {
    await user.click(newStage());
    await user.keyboard(`${name}{Enter}`);
  }
}

describe("the editor of the stages of a log", () => {
  it("says in one line whose the stages are and where they stay, and in the tooltip of that line that no investigation saves them yet", () => {
    setup();
    const line = screen.getByText("Stages are yours and stay in this browser");
    expect(editor().querySelectorAll("p.stages-note")[0]).toBe(line);
    expect(line.getAttribute("title")).toContain(
      "The stages are kept in this browser for this reading. They are not yet part of a saved investigation, so another browser or another computer does not show them.",
    );
    // What a stage is and what the map does with it is said there too, and no longer as a paragraph of the editor.
    expect(line.getAttribute("title")).toContain("nothing is built in, and nothing is derived from the records.");
    expect(editor().textContent).not.toContain("A stage holds activities that belong together");
    expect(screen.getByText("No stage is defined for this log yet, so the map is drawn without stages.")).toBeTruthy();
  });

  it("lists every activity of the parent's map with its incidents, the most frequent first, and nothing to choose before a stage is defined", () => {
    setup();
    const table = screen.getByRole("table", { name: "Activities and their stage" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => [within(row).getByRole("rowheader").textContent, within(row).getAllByRole("cell")[0].textContent])).toEqual([
      [closed, "40"],
      [opened, "7"],
      [checked, "7"],
    ]);
    expect(editor().textContent).toContain("3 activities on the map of every incident of the parent, the most frequent first.");
    for (const activity of [opened, closed, checked]) {
      expect(stageOf(activity).disabled).toBe(true);
      expect(stageOf(activity).value).toBe("");
    }
  });

  it("adds stages by name from the keyboard and says what it did", async () => {
    const { user, store } = setup();
    await addStages(user, "Intake");
    expect(stageNames()).toEqual(["Intake"]);
    expect(said()).toBe("Stage “Intake” added as stage 1.");
    // The field is ready for the next stage.
    expect(newStage().value).toBe("");
    expect(document.activeElement).toBe(newStage());
    await user.keyboard("  Closure ");
    await user.click(screen.getByRole("button", { name: "Add stage" }));
    expect(stageNames()).toEqual(["Intake", "Closure"]);
    expect(said()).toBe("Stage “Closure” added as stage 2.");
    expect(names(store.stateOf(reading).definitions)).toEqual(["Intake", "Closure"]);

    // No stage without a name, and no two of one name.
    await user.click(screen.getByRole("button", { name: "Add stage" }));
    expect(said()).toBe("A stage needs a name.");
    await addStages(user, "intake");
    expect(said()).toBe("Another stage is already called “intake”.");
    expect(stageNames()).toEqual(["Intake", "Closure"]);
    expect(newStage().value).toBe("intake");
  });

  it("puts an activity into a stage or into none, and counts the activities of each stage", async () => {
    const { user, store } = setup();
    await addStages(user, "Intake", "Closure");
    const [intake, closure] = store.stateOf(reading).definitions.stages.map((stage) => stage.id);
    expect(stageOf(opened).disabled).toBe(false);
    expect(Array.from(stageOf(opened).options).map((option) => option.textContent)).toEqual(["No stage", "Intake", "Closure"]);

    await user.selectOptions(stageOf(opened), "Intake");
    await user.selectOptions(stageOf(checked), "Intake");
    await user.selectOptions(stageOf(closed), "Closure");
    expect(store.stateOf(reading).definitions.assigned).toEqual(
      new Map([
        [opened, intake],
        [checked, intake],
        [closed, closure],
      ]),
    );
    expect(stageRows().map((row) => row.querySelector(".stages-count")?.textContent)).toEqual(["2 activities", "1 activity"]);
    expect(editor().textContent).toContain("; 0 in no stage.");

    await user.selectOptions(stageOf(checked), "No stage");
    expect(store.stateOf(reading).definitions.assigned.has(checked)).toBe(false);
    expect(stageOf(checked).value).toBe("");
    expect(editor().textContent).toContain("; 1 in no stage.");
  });

  it("renames a stage when its field is left or Enter is pressed, and refuses a name it cannot have", async () => {
    const { user, store } = setup();
    await addStages(user, "Intake", "Closure");
    await user.selectOptions(stageOf(opened), "Intake");
    const first = () => screen.getByRole("textbox", { name: "Name of stage 1" }) as HTMLInputElement;

    await user.clear(first());
    await user.type(first(), "Customer side");
    // Not before the name is given: the map would be arranged anew at every key.
    expect(names(store.stateOf(reading).definitions)).toEqual(["Intake", "Closure"]);
    await user.keyboard("{Enter}");
    expect(names(store.stateOf(reading).definitions)).toEqual(["Customer side", "Closure"]);
    expect(said()).toBe("Stage “Intake” is now called “Customer side”.");
    // The stage is the same one: its activity stays in it, under its new name.
    expect(stageOf(opened).selectedOptions[0].textContent).toBe("Customer side");
    expect(screen.getByRole("button", { name: "Remove the stage “Customer side”" })).toBeTruthy();

    await user.clear(first());
    await user.type(first(), "Company side");
    await user.tab();
    expect(names(store.stateOf(reading).definitions)).toEqual(["Company side", "Closure"]);

    await user.clear(first());
    await user.type(first(), "closure{Enter}");
    expect(said()).toBe("Another stage is already called “closure”. “Company side” keeps its name.");
    expect(first().value).toBe("Company side");
    await user.clear(first());
    await user.tab();
    expect(said()).toBe("A stage needs a name. “Company side” keeps its name.");
    expect(first().value).toBe("Company side");
    expect(names(store.stateOf(reading).definitions)).toEqual(["Company side", "Closure"]);
  });

  it("takes a name back with Escape, and lets the key through once there is nothing to take back", async () => {
    const { user, store } = setup();
    await addStages(user, "Intake");
    const escapes: boolean[] = [];
    const listen = (event: KeyboardEvent) => event.key === "Escape" && escapes.push(event.defaultPrevented);
    document.addEventListener("keydown", listen);
    const first = screen.getByRole("textbox", { name: "Name of stage 1" }) as HTMLInputElement;
    await user.type(first, " desk{Escape}");
    expect(first.value).toBe("Intake");
    await user.keyboard("{Escape}");
    document.removeEventListener("keydown", listen);
    // The first Escape was the field's; the second belongs to whatever else the screen has open.
    expect(escapes).toEqual([true, false]);
    await user.tab();
    expect(names(store.stateOf(reading).definitions)).toEqual(["Intake"]);
  });

  it("moves a stage earlier or later from the keyboard, which stays on the button it pressed", async () => {
    const { user, store } = setup();
    await addStages(user, "Intake", "Work", "Closure");
    const button = (name: string) => screen.getByRole("button", { name });
    expect(button("Move “Intake” earlier").getAttribute("aria-disabled")).toBe("true");
    expect(button("Move “Closure” later").getAttribute("aria-disabled")).toBe("true");
    expect(button("Move “Work” earlier").hasAttribute("aria-disabled")).toBe(false);

    // A browser takes the keyboard from a row it moves in the page. The editor hands it to the button that was pressed,
    // here also where the keyboard was elsewhere before.
    (document.activeElement as HTMLElement).blur();
    fireEvent.click(button("Move “Intake” later"));
    expect(stageNames()).toEqual(["Work", "Intake", "Closure"]);
    expect(said()).toBe("“Intake” is now stage 2 of 3.");
    expect(document.activeElement).toBe(button("Move “Intake” later"));
    await user.keyboard(" ");
    expect(stageNames()).toEqual(["Work", "Closure", "Intake"]);
    // At the end the button stays where the keyboard is and does nothing more.
    expect(document.activeElement).toBe(button("Move “Intake” later"));
    expect(button("Move “Intake” later").getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Enter}");
    expect(stageNames()).toEqual(["Work", "Closure", "Intake"]);
    expect(said()).toBe("“Intake” is now stage 3 of 3.");

    await user.click(button("Move “Closure” earlier"));
    expect(names(store.stateOf(reading).definitions)).toEqual(["Closure", "Work", "Intake"]);
    expect(document.activeElement).toBe(button("Move “Closure” earlier"));
    expect(Array.from(stageOf(opened).options).map((option) => option.textContent)).toEqual(["No stage", "Closure", "Work", "Intake"]);
  });

  it("removes a stage, leaves its activities in no stage and hands the keyboard to the field for a new stage", async () => {
    const { user, store } = setup();
    await addStages(user, "Intake", "Closure");
    await user.selectOptions(stageOf(opened), "Intake");
    await user.selectOptions(stageOf(checked), "Intake");
    await user.selectOptions(stageOf(closed), "Closure");

    await user.click(screen.getByRole("button", { name: "Remove the stage “Intake”" }));
    expect(stageNames()).toEqual(["Closure"]);
    expect(said()).toBe("Stage “Intake” removed. Its 2 activities are in no stage now.");
    expect(stageOf(opened).value).toBe("");
    expect(stageOf(checked).value).toBe("");
    expect(stageOf(closed).selectedOptions[0].textContent).toBe("Closure");
    expect(document.activeElement).toBe(newStage());

    await user.click(screen.getByRole("button", { name: "Remove the stage “Closure”" }));
    expect(said()).toBe("Stage “Closure” removed. Its 1 activity is in no stage now.");
    expect(store.stateOf(reading).definitions).toEqual(noStages);
    expect(screen.queryByRole("list", { name: "Stages, the earliest first" })).toBeNull();
    expect(stageOf(closed).disabled).toBe(true);
  });

  it("keeps the stages in the browser for the reading: a page opened later shows them, another reading does not", async () => {
    const first = setup();
    await addStages(first.user, "Intake", "Closure");
    await first.user.selectOptions(stageOf(closed), "Closure");
    first.view.unmount();

    // Another page: another store over the same browser.
    const later = setup();
    expect(stageNames()).toEqual(["Intake", "Closure"]);
    expect(stageOf(closed).selectedOptions[0].textContent).toBe("Closure");
    expect(stageOf(opened).value).toBe("");
    later.view.unmount();

    render(<StagesEditor reading={{ workspaceId, preparationId: earlierPreparationId }} parentGraph={parentGraph} store={new StageStore()} />);
    expect(screen.queryByRole("list", { name: "Stages, the earliest first" })).toBeNull();
    expect(screen.getByText("No stage is defined for this log yet, so the map is drawn without stages.")).toBeTruthy();
  });

  it("says so where the browser keeps nothing, and goes on with the stages for as long as the page is open", async () => {
    const nothing: StageMemory = { recall: () => null, remember: () => false };
    const { user, store } = setup(new StageStore(nothing));
    // That nothing is kept limits what the editor is good for: it stays in the editor itself, in the place of the line that says where the stages stay.
    const line = screen.getByText("This browser keeps nothing for this page, so the stages last only until the page is closed or loaded again.");
    expect(line.className).toContain("stages-not-kept");
    expect(line.getAttribute("title")).toContain("They are not part of a saved investigation.");
    expect(editor().textContent).not.toContain("stay in this browser");
    await addStages(user, "Intake");
    await user.selectOptions(stageOf(opened), "Intake");
    expect(stageNames()).toEqual(["Intake"]);
    expect(store.stateOf(reading).definitions.assigned.size).toBe(1);
    expect(window.localStorage.length).toBe(0);
  });

  it("keeps the stage of an activity that the parent's map does not have, and does not list it", async () => {
    const { user, store } = setup(undefined, { ...parentGraph, nodes: parentGraph.nodes.filter((node) => node.label !== checked) });
    await addStages(user, "Intake");
    store.change(reading, (definitions) => ({ ...definitions, assigned: new Map([[checked, definitions.stages[0].id]]) }));
    expect(screen.queryByRole("combobox", { name: `Stage of “${checked}”` })).toBeNull();
    // Counted is what the map has.
    expect(stageRows()[0].querySelector(".stages-count")?.textContent).toBe("0 activities");
    await user.selectOptions(stageOf(opened), "Intake");
    expect([...store.stateOf(reading).definitions.assigned.keys()]).toEqual([checked, opened]);
  });
});
