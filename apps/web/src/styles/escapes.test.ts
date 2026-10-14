import { describe, expect, it } from "vitest";

const sheets = import.meta.glob("../**/*.css", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("the stylesheets as written", () => {
  it("are found", () => {
    expect(Object.keys(sheets).length).toBeGreaterThan(3);
  });

  it("hold no backslash outside a quoted string: a stray one joins what follows it into one broken rule", () => {
    for (const [file, css] of Object.entries(sheets)) {
      const unquoted = css.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, "");
      expect(unquoted.includes("\\"), file).toBe(false);
    }
  });
});
