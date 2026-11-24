import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Kontrast tokenów wyglądu (plan `docs/plan-design.md`): pary tekst/tło z `globals.css` w trybie jasnym i ciemnym muszą spełniać
// WCAG AA (4,5:1 dla zwykłego tekstu, 3:1 dla elementów interfejsu i fokusa). Test czyta prawdziwy plik CSS.

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\r\n/g, "\n");

function declarations(block: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6});/g)) {
    result[match[1]] = match[2].toUpperCase();
  }
  return result;
}

function blockAfter(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`Brak „${marker}” w globals.css`);
  }
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

const light = declarations(blockAfter(css, ":root {"));
const darkStart = css.indexOf("prefers-color-scheme: dark");
const dark = { ...light, ...declarations(blockAfter(css.slice(darkStart), ":root {")) };

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const MODES = { jasny: light, ciemny: dark } as const;
const STATES = ["ai", "low", "medium", "high", "main"] as const;

describe("tokeny wyglądu: kontrast WCAG AA", () => {
  it("tokeny istnieją w obu trybach (wszystkie wartości to kolory szesnastkowe)", () => {
    for (const [mode, tokens] of Object.entries(MODES)) {
      for (const name of ["bg-from", "bg-to", "surface", "tint", "text", "muted", "border", "head-from", "head-to", "on-head", "accent-from", "accent-to", "on-accent", "ring", "danger"]) {
        expect(tokens[name], `${mode}: ${name}`).toMatch(/^#[0-9A-F]{6}$/);
      }
      for (const state of STATES) {
        for (const part of ["bg", "fg", "border"]) {
          expect(tokens[`${state}-${part}`], `${mode}: ${state}-${part}`).toMatch(/^#[0-9A-F]{6}$/);
        }
      }
    }
  });

  for (const [mode, tokens] of Object.entries(MODES)) {
    describe(`tryb ${mode}`, () => {
      it("tekst i tekst przytłumiony na powierzchni, tincie i obu końcach gradientu tła ≥ 4,5:1", () => {
        for (const background of ["surface", "tint", "bg-from", "bg-to"]) {
          expect(contrast(tokens.text, tokens[background]), `text na ${background}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(tokens.muted, tokens[background]), `muted na ${background}`).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("tekst nagłówka na obu końcach gradientu nagłówka ≥ 4,5:1", () => {
        for (const end of ["head-from", "head-to"]) {
          expect(contrast(tokens["on-head"], tokens[end]), end).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("tekst przycisku głównego na obu końcach gradientu akcentu ≥ 4,5:1", () => {
        for (const end of ["accent-from", "accent-to"]) {
          expect(contrast(tokens["on-accent"], tokens[end]), end).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("każdy stan ma tekst na własnym tle ≥ 4,5:1,", () => {
        for (const state of STATES) {
          expect(contrast(tokens[`${state}-fg`], tokens[`${state}-bg`]), state).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("błąd (danger) na powierzchni ≥ 4,5:1, a pierścień fokusa na powierzchni i na tle strony ≥ 3:1", () => {
        expect(contrast(tokens.danger, tokens.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens.danger, tokens["bg-from"])).toBeGreaterThanOrEqual(4.5);
        for (const background of ["surface", "bg-from", "bg-to", "tint"]) {
          expect(contrast(tokens.ring, tokens[background]), `ring na ${background}`).toBeGreaterThanOrEqual(3);
        }
      });
    });
  }

  it("gradienty są zdefiniowane na tokenach (tło, nagłówek, akcent), a font to Noto Sans z pliku lokalnego", () => {
    expect(css).toContain("--grad-bg: linear-gradient");
    expect(css).toContain("--grad-head: linear-gradient");
    expect(css).toContain("--grad-accent: linear-gradient");
    expect(css).toContain("--font-noto-sans");
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toContain('from "next/font/local"');
    expect(layout).not.toContain("next/font/google");
    expect(layout).toContain("NotoSans-Regular.ttf");
    expect(layout).toContain("NotoSans-Bold.ttf");
  });
});
