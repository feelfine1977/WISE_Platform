import { describe, expect, it } from "vitest";
import page from "../../index.html?raw";
import mapTokens from "wise-flow/tokens.css?raw";
import tokens from "./tokens.css?raw";

const stylesheets = import.meta.glob<string>("../**/*.css", { query: "?raw", import: "default", eager: true });
const sources = import.meta.glob<string>(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}", "!../test/**", "!../generated/**"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const tokenSheet = "./tokens.css";
const otherSheets = Object.entries(stylesheets).filter(([path]) => path !== tokenSheet);

interface Declaration {
  property: string;
  value: string;
}

/** Every declaration of a stylesheet; selectors and at-rule preludes (such as media queries) are skipped. */
function declarations(css: string): Declaration[] {
  const found: Declaration[] = [];
  let text = "";
  for (const character of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (character === "{") {
      text = "";
    } else if (character === ";" || character === "}") {
      const colon = text.indexOf(":");
      const statement = text.trim();
      if (colon > 0 && !statement.startsWith("@")) {
        found.push({ property: text.slice(0, colon).trim().toLowerCase(), value: text.slice(colon + 1).trim() });
      }
      text = "";
    } else {
      text += character;
    }
  }
  return found;
}

/** The custom properties of the first `:root` block: the light values of the map library. */
function rootProperties(css: string): Map<string, string> {
  const start = css.indexOf(":root {");
  const end = css.indexOf("}", start);
  const block = css.slice(start, end + 1);
  return new Map(declarations(block).filter((item) => item.property.startsWith("--")).map((item) => [item.property, item.value]));
}

const colourLiteral = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i;
const lengthLiteral = /\d*\.?\d+(?:px|r?em|ex|ch|pt|pc|cm|mm|in|q|r?lh|[dsl]?v(?:h|w|min|max)|cq(?:w|h|i|b|min|max))\b/i;

/** Properties whose values are colours, radii, type sizes or spacing. */
const tokenOnly =
  /^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-(?:color|width|radius))?|border-(?:top|bottom)-(?:left|right)-radius|outline(?:-(?:color|width|offset))?|box-shadow|text-decoration-color|caret-color|accent-color|fill|stroke|font|font-size|font-family|font-weight|line-height|letter-spacing|word-spacing|text-indent|(?:margin|padding)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?|gap|row-gap|column-gap|inset(?:-(?:block|inline))?|top|right|bottom|left)$/;
/** Words that are allowed next to token references in those properties. */
const keywords = new Set(["none", "transparent", "currentcolor", "inherit", "initial", "unset", "solid", "dashed", "dotted", "auto", "inset", "normal", "italic"]);

function problemsOf(css: string): string[] {
  const problems: string[] = [];
  for (const { property, value } of declarations(css)) {
    const where = `${property}: ${value}`;
    if (property.startsWith("--")) problems.push(`${where} (a token outside the token stylesheet)`);
    const literal = value.replace(/var\(--[\w-]+\)/g, "");
    if (colourLiteral.test(literal)) problems.push(`${where} (a colour)`);
    if (lengthLiteral.test(literal)) problems.push(`${where} (a length)`);
    if (tokenOnly.test(property)) {
      const rest = literal.replace(/calc\(|[()*+/,-]/g, " ").split(/\s+/).filter(Boolean);
      for (const word of rest) {
        if (word !== "0" && !keywords.has(word.toLowerCase())) problems.push(`${where} ("${word}" is not a token)`);
      }
    }
  }
  return problems;
}

describe("the token stylesheet", () => {
  it("is the only place where a colour, radius, font size or spacing value is written", () => {
    expect(otherSheets.length).toBeGreaterThan(0);
    for (const [path, css] of otherSheets) expect(problemsOf(css), path).toEqual([]);
  });

  it("finds a value written outside the tokens", () => {
    expect(problemsOf(".a { color: #1f1f1f; }")).not.toEqual([]);
    expect(problemsOf(".a { background: rgba(0, 0, 0, 0.1); }")).not.toEqual([]);
    expect(problemsOf(".a { color: white; }")).not.toEqual([]);
    expect(problemsOf(".a { padding: var(--space-2) 6px; }")).not.toEqual([]);
    expect(problemsOf(".a { margin-left: 5%; }")).not.toEqual([]);
    expect(problemsOf(".a { border-radius: 3px; }")).not.toEqual([]);
    expect(problemsOf(".a { font: 12px monospace; }")).not.toEqual([]);
    expect(problemsOf(".a { width: 440px; }")).not.toEqual([]);
    expect(problemsOf(".a { padding: var(--space-2, 6px); }")).not.toEqual([]);
    expect(problemsOf(":root { --space-9: 36px; }")).not.toEqual([]);
    expect(problemsOf("@media (max-width: 1100px) { .a { padding: 0 var(--space-4); border: var(--line-width) solid var(--color-line); } }")).toEqual([]);
  });

  it("defines every token the stylesheets use", () => {
    const defined = new Set([...rootProperties(mapTokens).keys(), ...rootProperties(tokens).keys()]);
    for (const [path, css] of Object.entries(stylesheets)) {
      const used = [...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]);
      expect(used.filter((name) => !defined.has(name)), path).toEqual([]);
    }
  });

  it("is the only source of style in the page and the components", () => {
    expect(page).toContain('data-theme="light"');
    expect(page).not.toMatch(colourLiteral);
    expect(page).not.toMatch(/<style|\sstyle=/i);
    for (const [path, source] of Object.entries(sources)) {
      expect(source, path).not.toMatch(/\bstyle=\{|\.style\./);
      expect(source, path).not.toMatch(/["'`]#[0-9a-f]{3,8}\b|\brgba?\(/i);
    }
  });
});

type Rgba = [number, number, number, number];

const tokenValues = new Map([...rootProperties(mapTokens), ...rootProperties(tokens)]);

/** The colour a token stands for, following references to other tokens. */
function colourOf(token: string): Rgba {
  let value = tokenValues.get(token);
  for (let step = 0; value?.startsWith("var(") && step < 10; step += 1) value = tokenValues.get(value.slice(4, -1).trim());
  if (value === undefined) throw new Error(`${token} is not defined`);
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (hex) return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16), 1];
  const rgba = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(value);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
  throw new Error(`${token} is not a colour this check reads: ${value}`);
}

/** A colour as it appears painted over the given backgrounds, the last one lowest. */
function painted(...layers: string[]): Rgba {
  return layers
    .map(colourOf)
    .reverse()
    .reduce((below, [r, g, b, a]) => [r * a + below[0] * (1 - a), g * a + below[1] * (1 - a), b * a + below[2] * (1 - a), 1]);
}

function luminance([r, g, b]: Rgba): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(one: Rgba, other: Rgba): number {
  const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** Backgrounds on which text and focusable controls sit, each with the layers that make it. */
const pageBackgrounds: Record<string, string[]> = {
  surface: ["--color-surface"],
  canvas: ["--color-canvas"],
  "row hover": ["--color-hover"],
  "selected row": ["--color-accent-tint", "--color-surface"],
};
const barBackgrounds: Record<string, string[]> = {
  "app bar": ["--color-bar"],
  "app bar hover": ["--color-bar-hover", "--color-bar"],
};

describe("contrast of the tokens", () => {
  it("measures a known pair", () => {
    expect(contrast([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 5);
    expect(contrast([118, 118, 118, 1], [255, 255, 255, 1])).toBeCloseTo(4.54, 2);
  });

  it("keeps text at least 4.5:1 against its background", () => {
    const pairs: [string, string, string[]][] = [];
    for (const [name, layers] of Object.entries(pageBackgrounds)) {
      pairs.push(["--color-ink", name, layers], ["--color-ink-muted", name, layers]);
    }
    for (const [name, layers] of Object.entries(barBackgrounds)) {
      pairs.push(["--color-bar-ink", name, layers], ["--color-bar-ink-muted", name, layers]);
    }
    pairs.push(
      ["--color-on-accent", "primary action", ["--color-accent"]],
      ["--color-on-accent", "primary action under the pointer", ["--color-accent-strong"]],
      ["--color-accent", "surface", ["--color-surface"]],
    );
    for (const [text, name, layers] of pairs) {
      expect(contrast(colourOf(text), painted(...layers)), `${text} on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the focus ring, the selection bar, the error bar and the status dots at least 3:1 against what is next to them", () => {
    // The ring is drawn apart from the control, so on both of its sides lies the background the control sits on.
    for (const [name, layers] of Object.entries(pageBackgrounds)) {
      expect(contrast(colourOf("--color-accent"), painted(...layers)), `focus ring on ${name}`).toBeGreaterThanOrEqual(3);
    }
    for (const [name, layers] of Object.entries(barBackgrounds)) {
      expect(contrast(colourOf("--color-accent-on-bar"), painted(...layers)), `focus ring on ${name}`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(colourOf("--color-accent"), painted("--color-accent-tint", "--color-surface")), "selection bar").toBeGreaterThanOrEqual(3);
    expect(contrast(colourOf("--color-error"), painted("--color-surface")), "error bar").toBeGreaterThanOrEqual(3);
    for (const dot of ["--color-status-ready", "--color-status-checking", "--color-status-unavailable"]) {
      expect(contrast(colourOf(dot), painted("--color-bar")), dot).toBeGreaterThanOrEqual(3);
    }
  });
});
