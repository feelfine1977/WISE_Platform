import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Icon, ICON_NAMES, IconButton } from "./icons";

/** What says more about a button than its name: the texts its description refers to. */
const descriptionOf = (button: HTMLElement) =>
  (button.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent);

describe("the icons", () => {
  it("are drawn in a 16 px box as pictures that assistive technology passes over, with size, line and colour left to the stylesheet", () => {
    expect(ICON_NAMES).toEqual([
      "undo", "redo", "clearAll", "save", "sidePanel", "info", "table", "map", "paths", "stages", "show", "hide", "sort",
      "pin", "overview", "editStages", "orientation", "close", "collapse", "fullWidth",
    ]);
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      const drawing = container.querySelector("svg")!;
      expect(drawing.getAttribute("viewBox"), name).toBe("0 0 16 16");
      expect(drawing.getAttribute("aria-hidden"), name).toBe("true");
      expect(drawing.querySelector("path")?.getAttribute("d"), name).toMatch(/^M/);
      for (const part of [drawing, ...drawing.querySelectorAll("path")]) {
        for (const written of ["style", "width", "height", "fill", "stroke", "stroke-width"]) expect(part.hasAttribute(written), `${name} ${written}`).toBe(false);
      }
      unmount();
    }
  });

  it("strike the eye through to hide what it shows, and fill only the corner of the overview", () => {
    const line = (name: (typeof ICON_NAMES)[number]) => {
      const { container, unmount } = render(<Icon name={name} />);
      const paths = Array.from(container.querySelectorAll("path"), (path) => [path.getAttribute("class"), path.getAttribute("d")]);
      unmount();
      return paths;
    };
    expect(line("hide")[0][1]).toBe(`${line("show")[0][1]}M3 13 13 3`);
    expect(line("overview").map(([filled]) => filled)).toEqual([null, "icon-filled"]);
    expect(ICON_NAMES.filter((name) => line(name).length > 1)).toEqual(["overview"]);
  });
});

describe("a button of one icon", () => {
  it("has its words as its accessible name and as its tooltip, whatever icon it shows", () => {
    render(
      <>
        {ICON_NAMES.map((name) => (
          <IconButton key={name} icon={name} label={`Do ${name}`} />
        ))}
      </>,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(ICON_NAMES.length);
    for (const [index, name] of ICON_NAMES.entries()) {
      expect(screen.getByRole("button", { name: `Do ${name}` })).toBe(buttons[index]);
      expect(buttons[index].getAttribute("title")).toBe(`Do ${name}`);
      expect(buttons[index].getAttribute("type")).toBe("button");
      // Its name says all there is to say: it is no switch and nothing describes it further.
      expect(buttons[index].hasAttribute("aria-pressed")).toBe(false);
      expect(buttons[index].hasAttribute("aria-describedby")).toBe(false);
      expect(buttons[index].querySelector("svg")).not.toBeNull();
    }
  });

  it("says as a switch whether it is on, and does what it is given to do", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<IconButton icon="pin" label="Keep activities in place" pressed={false} onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Keep activities in place" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { pressed: false })).toBe(button);

    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<IconButton icon="pin" label="Keep activities in place" pressed onClick={onClick} />);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { pressed: true })).toBe(button);

    // From the keyboard as from the pointer.
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it("carries a mark that something is left to read, as a dot for the eye and in words for assistive technology", () => {
    const { rerender } = render(<IconButton icon="info" label="About this map" />);
    const button = screen.getByRole("button", { name: "About this map" });
    expect(button.querySelector(".icon-button-mark")).toBeNull();

    rerender(<IconButton icon="info" label="About this map" mark="Some flows are not drawn" />);
    const dot = button.querySelector(".icon-button-mark")!;
    expect(dot.getAttribute("aria-hidden")).toBe("true");
    expect(dot.textContent).toBe("");
    // The words are no part of the name, which stays what the button does; they describe it.
    expect(screen.getByRole("button", { name: "About this map" })).toBe(button);
    expect(descriptionOf(button)).toEqual(["Some flows are not drawn"]);
    expect(button.querySelector(".visually-hidden")?.textContent).toBe("Some flows are not drawn");
    expect(button.getAttribute("title")).toBe("About this map\nSome flows are not drawn");

    rerender(<IconButton icon="info" label="About this map" />);
    expect(button.querySelector(".icon-button-mark")).toBeNull();
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  });

  it("says what more there is to say about it in its tooltip and as its description, and keeps its name short", () => {
    render(<IconButton icon="pin" label="Keep activities in place" hint="Off, the map is arranged anew." mark="Not available" pressed={false} />);
    const button = screen.getByRole("button", { name: "Keep activities in place" });
    expect(button.getAttribute("title")).toBe("Keep activities in place\nOff, the map is arranged anew.\nNot available");
    expect(descriptionOf(button)).toEqual(["Off, the map is arranged anew.", "Not available"]);
  });

  it("takes what a button takes: it can wait, and say which panel it opens", () => {
    render(<IconButton icon="info" label="About this data" disabled aria-expanded={false} aria-controls="panel" />);
    const button = screen.getByRole("button", { name: "About this data" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBe("panel");
  });
});
