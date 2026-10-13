import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../App";
import { healthy, scriptedClient } from "../test/answers";
import { scriptedImportClient, workspaceAnswer } from "../test/imports";
import { scriptedSelectionClient } from "../test/selections";
import { scriptedViewClient } from "../test/views";

function renderApp() {
  const imports = scriptedImportClient();
  const user = userEvent.setup();
  render(
    <App
      client={scriptedClient().client}
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

const noPreparation = "Open the incidents of a preparation in the Data area first.";

describe("the area tabs of the app bar", () => {
  it("list the areas in the order of the work, mark the current one, and name why an area needs a preparation", async () => {
    const app = renderApp();
    expect(states()).toEqual([
      { name: "Data", current: null, disabled: null, reason: null },
      { name: "Investigations", current: "page", disabled: null, reason: null },
      { name: "Compare", current: null, disabled: "true", reason: noPreparation },
      { name: "Expectation", current: null, disabled: "true", reason: noPreparation },
      { name: "Saved", current: null, disabled: null, reason: null },
    ]);
    // A tab that cannot be opened stays in the keyboard path, so its reason can be reached.
    expect(tabs().every((button) => !button.hasAttribute("disabled"))).toBe(true);

    await app.user.click(tab("Compare"));
    expect(tab("Compare").getAttribute("aria-current")).toBeNull();
    expect(tab("Investigations").getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("heading", { name: "Compare" })).toBeNull();

    await app.user.click(tab("Saved"));
    expect(states().map((item) => item.current)).toEqual([null, null, null, null, "page"]);

    await app.user.click(tab("Data"));
    expect(states().map((item) => item.current)).toEqual(["page", null, null, null, null]);
    await app.user.type(screen.getByLabelText("Folder path"), "C:\\Users\\Analyst\\Investigations");
    await app.user.click(screen.getByRole("button", { name: "Open workspace" }));
    const workspace = app.imports.workspaces[0];
    await act(async () => workspace.reply({ ok: true, answer: workspaceAnswer(workspace.request, true) }));
    const preparations = screen.getByRole("table", { name: "Prepared readings in this workspace" });
    await app.user.click(within(preparations).getByRole("button", { name: /^Open incidents of/ }));

    expect(states()).toEqual([
      { name: "Data", current: null, disabled: null, reason: null },
      { name: "Investigations", current: "page", disabled: null, reason: null },
      { name: "Compare", current: null, disabled: null, reason: null },
      { name: "Expectation", current: null, disabled: null, reason: null },
      { name: "Saved", current: null, disabled: null, reason: null },
    ]);

    await app.user.click(tab("Compare"));
    expect(states().map((item) => item.current)).toEqual([null, null, "page", null, null]);
    expect(screen.getByRole("heading", { name: "Compare" })).toBeTruthy();

    await app.user.click(tab("Expectation"));
    expect(states().map((item) => item.current)).toEqual([null, null, null, "page", null]);
    expect(screen.getByRole("heading", { name: "Expectation" })).toBeTruthy();

    await app.user.click(tab("Investigations"));
    expect(states().map((item) => item.current)).toEqual([null, "page", null, null, null]);
  });

  it("are reached and chosen with the keyboard", async () => {
    const app = renderApp();
    tab("Data").focus();
    await app.user.keyboard("{Enter}");
    expect(tab("Data").getAttribute("aria-current")).toBe("page");
    await app.user.tab();
    expect(document.activeElement).toBe(tab("Investigations"));
    await app.user.tab();
    expect(document.activeElement).toBe(tab("Compare"));
    await app.user.keyboard("{Enter}");
    expect(tab("Data").getAttribute("aria-current")).toBe("page");
  });
});
