import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "../App";
import { healthy } from "../test/answers";
import { scriptedImportClient } from "../test/imports";
import { scriptedSelectionClient } from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { AreaTabs } from "./AreaTabs";

function renderApp() {
  const imports = scriptedImportClient();
  const user = userEvent.setup();
  render(
    <App
      importClient={imports.client}
      selectionClient={scriptedSelectionClient().client}
      viewClient={scriptedViewClient().client}
      checkHealth={healthy}
    />,
  );
  return { imports, user };
}

function tabs(): HTMLElement[] {
  return within(screen.getByRole("navigation", { name: "Areas" })).getAllByRole("button");
}

function tab(name: string): HTMLElement {
  return within(screen.getByRole("navigation", { name: "Areas" })).getByRole("button", { name });
}

/** Each tab as its text, whether it is the current one, and why it cannot be opened (null when it can). */
function states() {
  return tabs().map((button) => {
    const described = button.getAttribute("aria-describedby");
    return {
      name: button.textContent,
      current: button.getAttribute("aria-current"),
      disabled: button.getAttribute("aria-disabled"),
      reason: described === null ? null : (document.getElementById(described)?.textContent ?? "missing"),
    };
  });
}

describe("the area tabs of the app bar", () => {
  it("list the areas in the order of the work, start in Investigations, and can all be entered before incidents are open", async () => {
    const app = renderApp();
    expect(states()).toEqual([
      { name: "Data", current: null, disabled: null, reason: null },
      { name: "Investigations", current: "page", disabled: null, reason: null },
      { name: "Purchasing analysis", current: null, disabled: null, reason: null },
      { name: "Compare", current: null, disabled: null, reason: null },
      { name: "Expectation", current: null, disabled: null, reason: null },
      { name: "Saved", current: null, disabled: null, reason: null },
    ]);

    // Before incidents are open, an area that needs them says so instead of refusing to open.
    await app.user.click(tab("Compare"));
    expect(states().map((item) => item.current)).toEqual([null, null, null, "page", null, null]);
    expect(screen.getByRole("heading", { name: "Compare" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go to the Data area" })).toBeTruthy();

    await app.user.click(tab("Expectation"));
    expect(states().map((item) => item.current)).toEqual([null, null, null, null, "page", null]);
    expect(screen.getByRole("heading", { name: "Expectation" })).toBeTruthy();
    expect(screen.getByText(/An expectation is scored for the incidents an investigation shows\./)).toBeTruthy();

    await app.user.click(tab("Saved"));
    expect(states().map((item) => item.current)).toEqual([null, null, null, null, null, "page"]);

    await app.user.click(tab("Data"));
    expect(states().map((item) => item.current)).toEqual(["page", null, null, null, null, null]);

    await app.user.click(tab("Investigations"));
    expect(states().map((item) => item.current)).toEqual([null, "page", null, null, null, null]);
  });

  it("are reached and chosen with the keyboard", async () => {
    const app = renderApp();
    tab("Data").focus();
    await app.user.keyboard("{Enter}");
    expect(tab("Data").getAttribute("aria-current")).toBe("page");
    await app.user.tab();
    expect(document.activeElement).toBe(tab("Investigations"));
    await app.user.tab();
    expect(document.activeElement).toBe(tab("Purchasing analysis"));
    await app.user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Purchasing analysis" })).toBeTruthy();
    await app.user.tab();
    expect(document.activeElement).toBe(tab("Compare"));
    await app.user.keyboard("{Enter}");
    expect(tab("Compare").getAttribute("aria-current")).toBe("page");
  });

  it("keep an area that cannot be opened focusable, name the reason, and do nothing when it is chosen", async () => {
    const user = userEvent.setup();
    const choose = vi.fn();
    render(
      <AreaTabs
        tabs={[
          { id: "first", label: "First", unavailable: null },
          { id: "second", label: "Second", unavailable: "Finish the first area before this one." },
        ]}
        current="first"
        onChoose={choose}
      />,
    );
    expect(states()).toEqual([
      { name: "First", current: "page", disabled: null, reason: null },
      { name: "Second", current: null, disabled: "true", reason: "Finish the first area before this one." },
    ]);
    expect(tabs().every((button) => !button.hasAttribute("disabled"))).toBe(true);
    await user.click(tab("Second"));
    expect(choose).not.toHaveBeenCalled();
    await user.click(tab("First"));
    expect(choose).toHaveBeenCalledWith("first");
  });
});
