import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { InfoPopover } from "./InfoPopover";

/** Whether each Escape that reached the page had been used by then, as a listener on the page finds it. */
const escapes: boolean[] = [];
const listen = (event: KeyboardEvent) => event.key === "Escape" && escapes.push(event.defaultPrevented);

function setup(mark?: string) {
  escapes.length = 0;
  document.addEventListener("keydown", listen);
  const user = userEvent.setup();
  render(
    <>
      <label>
        Before <input type="text" />
      </label>
      <InfoPopover label="About this map" mark={mark}>
        <h4>What the map counts</h4>
        <p>Every incident on the map.</p>
      </InfoPopover>
      <button type="button">After</button>
      <p>Beside it</p>
    </>,
  );
  return { user };
}

afterEach(() => document.removeEventListener("keydown", listen));

const button = () => screen.getByRole("button", { name: "About this map" });
const panel = () => screen.queryByRole("group", { name: "About this map" });

describe("the panel behind an info button", () => {
  it("is closed until its button is pressed, and then follows the button in the page with what it says", async () => {
    const { user } = setup();
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().hasAttribute("aria-controls")).toBe(false);
    expect(panel()).toBeNull();
    // What it says is not in the page before it is asked for.
    expect(screen.queryByText("Every incident on the map.")).toBeNull();

    await user.click(button());
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(button().getAttribute("aria-controls")).toBe(panel()!.id);
    expect(button().nextElementSibling).toBe(panel());
    expect(within(panel()!).getByRole("heading", { name: "What the map counts" })).toBeTruthy();
    expect(within(panel()!).getByText("Every incident on the map.")).toBeTruthy();
    // It can be long: it takes the keyboard after its button, so that it can be scrolled from there.
    await user.tab();
    expect(document.activeElement).toBe(panel());

    // The button closes it again.
    await user.click(button());
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(panel()).toBeNull();
  });

  it("opens from the keyboard, and Escape closes it, gives the keyboard back to the button and is used up by that", async () => {
    const { user } = setup();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(button());
    await user.keyboard("{Enter}");
    expect(panel()).not.toBeNull();
    await user.tab();
    expect(document.activeElement).toBe(panel());

    await user.keyboard("{Escape}");
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button());
    // Whatever else listens for the key, such as the history of an open incident, finds it used and stays open.
    expect(escapes).toEqual([true]);

    // Closed, the panel leaves the key to whoever else wants it.
    await user.keyboard("{Escape}");
    expect(escapes).toEqual([true, false]);
    expect(document.activeElement).toBe(button());
  });

  it("closes at a click outside it, not at one inside it, and gives the keyboard back to the button unless the click gave it to something else", async () => {
    const { user } = setup();
    await user.click(button());
    await user.click(within(panel()!).getByText("Every incident on the map."));
    expect(panel()).not.toBeNull();

    // A click on what takes no keyboard: the button has it again.
    await user.click(screen.getByText("Beside it"));
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button());

    // A click on a field: the field keeps it.
    await user.click(button());
    expect(panel()).not.toBeNull();
    await user.click(screen.getByRole("textbox", { name: "Before" }));
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Before" }));
  });

  it("closes when the keyboard goes on to something else, and leaves the keyboard there", async () => {
    const { user } = setup();
    button().focus();
    await user.keyboard(" ");
    expect(panel()).not.toBeNull();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "After" }));
    expect(panel()).toBeNull();
    expect(button().getAttribute("aria-expanded")).toBe("false");
  });

  it("carries a mark on its button while something is left to read in it, open or closed", async () => {
    const { user } = setup("Some flows are not drawn");
    const marked = () => [button().querySelector(".icon-button-mark") !== null, document.getElementById(button().getAttribute("aria-describedby") ?? "")?.textContent];
    expect(marked()).toEqual([true, "Some flows are not drawn"]);
    await user.click(button());
    expect(marked()).toEqual([true, "Some flows are not drawn"]);
  });
});
