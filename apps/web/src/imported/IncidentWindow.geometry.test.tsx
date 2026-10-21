/**
 * DOM representation and keyboard guards for the real IncidentWindow.
 * These checks do not assert jsdom layout, scrollHeight, or a painted row height.
 * The 438px viewport is an explicit measurement stub, matching the browser witness.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { caseSummaries } from "../test/imports";
import tokens from "../styles/tokens.css?raw";
import styles from "../workbench.css?raw";
import { type FocusRequest, IncidentWindow } from "./IncidentWindow";

const CASES = caseSummaries(40000);
const ROW_PIXELS = 32;
const VIEWPORT_PIXELS = 438;

beforeEach(() => {
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
    return this.classList.contains("window-scroll") ? VIEWPORT_PIXELS : 0;
  });
});
afterEach(() => vi.restoreAllMocks());

function renderWindow() {
  const onOpen = vi.fn();
  const view = (focusRequest: FocusRequest | null, openCaseId: string | null = null) => (
    <>
      <h2 id="all-incidents">All imported cases</h2>
      <p id="incident-help">Use the arrow keys and Enter to open complete evidence.</p>
      <IncidentWindow cases={CASES} openCaseId={openCaseId} onOpen={onOpen} focusRequest={focusRequest}
        labelledBy="all-incidents" describedBy="incident-help" />
    </>
  );
  const rendered = render(view(null));
  const table = screen.getByRole<HTMLTableElement>("table", { name: "All imported cases" });
  const scroller = table.parentElement!;
  return { table, scroller, onOpen, requestFocus: (request: FocusRequest, openCaseId: string | null = null) => rendered.rerender(view(request, openCaseId)) };
}

/** Every declared data position exists once, as a real row or an intrinsic SVG extent. */
function assertExtent(table: HTMLTableElement) {
  expect(table.getAttribute("aria-rowcount")).toBe("40001");
  expect(table.tHead?.rows[0].getAttribute("aria-rowindex")).toBe("1");
  expect(table.getAttribute("aria-describedby")).toBe("incident-help");
  let nextPosition = 0;
  let pixels = 0;
  let realRows = 0;
  for (const row of Array.from(table.tBodies[0].rows)) {
    if (row.classList.contains("window-spacer")) {
      expect(row.getAttribute("aria-hidden")).toBe("true");
      expect(row.hasAttribute("aria-rowindex")).toBe(false);
      const svg = row.querySelector("svg");
      expect(svg, "An empty table row has no reliable intrinsic extent.").not.toBeNull();
      expect(svg!.getAttribute("width")).toBe("1");
      expect(svg!.children).toHaveLength(0);
      expect(svg!.parentElement?.getAttribute("colspan")).toBe("5");
      expect(svg!.getAttribute("height")).toMatch(/^[1-9][0-9]*$/);
      const height = Number(svg!.getAttribute("height"));
      expect(height % ROW_PIXELS).toBe(0);
      nextPosition += height / ROW_PIXELS;
      pixels += height;
    } else {
      expect(row.getAttribute("aria-rowindex")).toBe(String(nextPosition + 2));
      expect(within(row).getByRole("button").textContent).toBe(`INC-${String(nextPosition).padStart(5, "0")}`);
      nextPosition += 1;
      pixels += ROW_PIXELS;
      realRows += 1;
    }
  }
  expect(nextPosition).toBe(40000);
  expect(pixels).toBe(1280000);
  expect(realRows).toBeGreaterThan(0);
  expect(realRows).toBeLessThan(40);
  expect(table.tBodies[0].rows.length).toBeLessThan(44);
}

function assertCurrent(table: HTMLTableElement, id: string) {
  const button = within(table).getByRole("button", { name: id });
  expect(document.activeElement).toBe(button);
  expect(within(table).getAllByRole("button").filter((candidate) => candidate.tabIndex === 0)).toEqual([button]);
  return button;
}

/** Targeted declaration guards; browser qualification is required for the actual CSS cascade. */
function rule(css: string, selector: string): Map<string, string> {
  const found = new Map<string, string>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@import[^;]*;/g, "");
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!match[1].split(",").some((candidate) => candidate.trim() === selector)) continue;
    for (const declaration of match[2].split(";")) {
      const colon = declaration.indexOf(":");
      if (colon >= 0) found.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
    }
  }
  return found;
}

describe("the case window's complete vertical representation", () => {
  it("keeps all 40,000 row extents through a middle request, End, Page Up and Home", async () => {
    const app = renderWindow();
    const user = userEvent.setup();
    assertExtent(app.table);
    expect(within(app.table).getAllByRole("button")).toHaveLength(22);
    expect(within(app.table).getByRole("button", { name: "INC-00000" }).tabIndex).toBe(0);

    app.requestFocus({ caseId: "INC-25000", token: 1 });
    assertCurrent(app.table, "INC-25000");
    assertExtent(app.table);
    expect(app.scroller.scrollTop).toBeGreaterThan(0);
    await user.keyboard("{Enter}");
    expect(app.onOpen).toHaveBeenLastCalledWith("INC-25000");

    await user.keyboard("{End}");
    const last = assertCurrent(app.table, "INC-39999");
    expect(last.closest("tr")?.getAttribute("aria-rowindex")).toBe("40001");
    expect(within(app.table).getAllByRole("button")).toHaveLength(21);
    assertExtent(app.table);
    await user.keyboard("{ArrowDown}");
    assertCurrent(app.table, "INC-39999");
    await user.keyboard("{PageUp}");
    assertCurrent(app.table, "INC-39987");
    assertExtent(app.table);
    await user.keyboard("{Enter}");
    expect(app.onOpen).toHaveBeenLastCalledWith("INC-39987");

    await user.keyboard("{Home}");
    const first = assertCurrent(app.table, "INC-00000");
    expect(first.closest("tr")?.getAttribute("aria-rowindex")).toBe("2");
    expect(app.scroller.scrollTop).toBe(0);
    assertExtent(app.table);
    await user.keyboard("{ArrowUp}");
    assertCurrent(app.table, "INC-00000");
    await user.keyboard("{Enter}");
    expect(app.onOpen.mock.calls).toEqual([["INC-25000"], ["INC-39987"], ["INC-00000"]]);
  });

  it("retains the focused middle row while scrolling and replays only a new focus request", async () => {
    const app = renderWindow();
    const user = userEvent.setup();
    const request = { caseId: "INC-25000", token: 1 };
    app.requestFocus(request, request.caseId);
    const focused = assertCurrent(app.table, request.caseId);
    expect(focused.getAttribute("aria-current")).toBe("true");
    const revealedScroll = app.scroller.scrollTop;
    fireEvent.scroll(app.scroller, { target: { scrollTop: 12000 * ROW_PIXELS } });
    expect(app.scroller.scrollTop).toBe(384000);
    expect(assertCurrent(app.table, request.caseId)).toBe(focused);
    expect(within(app.table).getByRole("button", { name: "INC-12000" })).toBeTruthy();
    assertExtent(app.table);

    app.requestFocus(request, request.caseId);
    expect(app.scroller.scrollTop).toBe(384000);
    assertCurrent(app.table, request.caseId);
    app.requestFocus({ ...request, token: 2 }, request.caseId);
    expect(app.scroller.scrollTop).toBe(revealedScroll);
    assertCurrent(app.table, request.caseId);
    assertExtent(app.table);
    await user.keyboard("{Enter}");
    expect(app.onOpen).toHaveBeenCalledExactlyOnceWith("INC-25000");
  });

  it("keeps the intrinsic spacer free of table-cell padding, border and inline baseline space", () => {
    expect(rule(tokens, ":root").get("--size-row")).toBe("32px");
    expect(rule(styles, ".window-table td").get("height")).toBe("var(--size-row)");
    const spacerCell = rule(styles, ".window-table .window-spacer td");
    expect(spacerCell.get("height")).toBe("auto");
    expect(spacerCell.get("padding")).toBe("0");
    expect(spacerCell.get("border")).toBe("0");
    // A block SVG has no inline baseline gap; a zero line-height would be an alternate design.
    expect(rule(styles, ".window-table .window-spacer svg").get("display")).toBe("block");
  });
});
