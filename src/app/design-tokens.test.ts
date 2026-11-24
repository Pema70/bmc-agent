import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Kontrast tokenów wyglądu (plan `docs/plan-design.md`): pary tekst/tło w trybie jasnym i ciemnym muszą spełniać WCAG AA
// (4,5:1 dla tekstu, 3:1 dla pierścienia fokusa). Test czyta prawdziwe pliki: `globals.css` (paleta A, obecnie w aplikacji)
// oraz statyczny podgląd palety D (`docs/design-preview/d.html`, kandydat), w którym bloki tokenów mają znaczniki
// `/* tokens:dark */` i `/* tokens:light */`.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

type Tokens = Record<string, string>;

function declarations(block: string): Tokens {
  const result: Tokens = {};
  for (const match of block.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6});/g)) {
    result[match[1]] = match[2].toUpperCase();
  }
  return result;
}

function blockAfter(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`Brak „${marker}”`);
  }
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

const globals = read("src/app/globals.css");
const globalsLight = declarations(blockAfter(globals, ":root {"));
const globalsDark = { ...globalsLight, ...declarations(blockAfter(globals.slice(globals.indexOf("prefers-color-scheme: dark")), ":root {")) };

const previewD = read("docs/design-preview/d.html");
const dDark = declarations(blockAfter(previewD, "/* tokens:dark */"));
const dLight = declarations(blockAfter(previewD, "/* tokens:light */"));

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) {
    return 0;
  }
  const raw = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (raw * 60 + 360) % 360;
}

function hueDistance(a: string, b: string): number {
  const difference = Math.abs(hue(a) - hue(b));
  return Math.min(difference, 360 - difference);
}

const STATES = ["ai", "low", "medium", "high", "main"] as const;
const REQUIRED = ["bg-from", "bg-to", "surface", "tint", "text", "muted", "border", "head-from", "head-to", "on-head", "accent-from", "accent-to", "on-accent", "ring", "danger"];

const PALETTES: Array<{ name: string; modes: Record<string, Tokens> }> = [
  { name: "A (globals.css, w aplikacji)", modes: { jasny: globalsLight, ciemny: globalsDark } },
  { name: "D (docs/design-preview/d.html)", modes: { ciemny: dDark, jasny: dLight } },
];

describe("tokeny wyglądu: kontrast WCAG AA", () => {
  for (const palette of PALETTES) {
    describe(`paleta ${palette.name}`, () => {
      for (const [mode, tokens] of Object.entries(palette.modes)) {
        describe(`tryb ${mode}`, () => {
          it("wszystkie tokeny są kolorami szesnastkowymi", () => {
            for (const name of REQUIRED) {
              expect(tokens[name], name).toMatch(/^#[0-9A-F]{6}$/);
            }
            for (const state of STATES) {
              for (const part of ["bg", "fg", "border"]) {
                expect(tokens[`${state}-${part}`], `${state}-${part}`).toMatch(/^#[0-9A-F]{6}$/);
              }
            }
          });

          it("tekst i tekst przytłumiony na powierzchni, tincie, końcach tła i szczytach poświaty ≥ 4,5:1", () => {
            const backgrounds = ["surface", "tint", "bg-from", "bg-to", "glow-navy-peak", "glow-coral-peak"].filter((name) => tokens[name]);
            for (const background of backgrounds) {
              expect(contrast(tokens.text, tokens[background]), `text na ${background}`).toBeGreaterThanOrEqual(4.5);
              expect(contrast(tokens.muted, tokens[background]), `muted na ${background}`).toBeGreaterThanOrEqual(4.5);
            }
          });

          it("tekst nagłówka na obu końcach gradientu nagłówka ≥ 4,5:1", () => {
            for (const end of ["head-from", "head-to"]) {
              expect(contrast(tokens["on-head"], tokens[end]), end).toBeGreaterThanOrEqual(4.5);
            }
          });

          it("tekst na obu końcach gradientu akcentu (i przycisku głównego, jeśli jest osobny) ≥ 4,5:1", () => {
            for (const end of ["accent-from", "accent-to"]) {
              expect(contrast(tokens["on-accent"], tokens[end]), end).toBeGreaterThanOrEqual(4.5);
            }
            if (tokens["primary-from"]) {
              for (const end of ["primary-from", "primary-to"]) {
                expect(contrast(tokens["on-primary"], tokens[end]), end).toBeGreaterThanOrEqual(4.5);
              }
            }
          });

          it("gradient tytułu (jeśli jest; duży pogrubiony tekst, WCAG AA 3:1) na tle strony i szczytach poświaty", () => {
            if (!tokens["title-from"]) {
              return;
            }
            for (const end of ["title-from", "title-to"]) {
              for (const background of ["bg-from", "bg-to", "glow-navy-peak", "glow-coral-peak"]) {
                expect(contrast(tokens[end], tokens[background]), `${end} na ${background}`).toBeGreaterThanOrEqual(3);
              }
            }
          });

          it("każdy stan ma tekst na własnym tle ≥ 4,5:1", () => {
            for (const state of STATES) {
              expect(contrast(tokens[`${state}-fg`], tokens[`${state}-bg`]), state).toBeGreaterThanOrEqual(4.5);
            }
          });

          it("błąd na powierzchni ≥ 4,5:1, a pierścień fokusa na powierzchni i tle ≥ 3:1", () => {
            expect(contrast(tokens.danger, tokens.surface)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(tokens.danger, tokens["bg-from"])).toBeGreaterThanOrEqual(4.5);
            for (const background of ["surface", "bg-from", "bg-to", "tint"]) {
              expect(contrast(tokens.ring, tokens[background]), `ring na ${background}`).toBeGreaterThanOrEqual(3);
            }
          });
        });
      }
    });
  }

  describe("paleta D: odróżnialność kolorów i struktura", () => {
    it("koral akcentu jest wyraźnie inny niż czerwień stanu „wpływ wysoki” (odległość barwy ≥ 28°), w obu trybach", () => {
      for (const tokens of [dDark, dLight]) {
        expect(hueDistance(tokens["accent-from"], tokens["high-fg"])).toBeGreaterThanOrEqual(28);
        expect(hueDistance(tokens["accent-to"], tokens["high-border"])).toBeGreaterThanOrEqual(28);
      }
    });

    it("fiolet oznaczenia AI jest wyraźnie inny niż niebieski przycisków i stanu „Główny” (≥ 40°), w obu trybach", () => {
      for (const tokens of [dDark, dLight]) {
        expect(hueDistance(tokens["ai-fg"], tokens["primary-from"])).toBeGreaterThanOrEqual(40);
        expect(hueDistance(tokens["ai-fg"], tokens["main-fg"])).toBeGreaterThanOrEqual(40);
        expect(hueDistance(tokens["ai-border"], tokens["main-border"])).toBeGreaterThanOrEqual(40);
      }
    });

    it("tryb ciemny jest domyślny (blok `:root`), jasny tylko przez `data-theme=\"light\"`; bez zależności od ustawienia systemu", () => {
      expect(previewD).toMatch(/\/\* tokens:dark \*\/\n:root \{/);
      expect(previewD).toMatch(/\/\* tokens:light \*\/\n:root\[data-theme="light"\] \{/);
      expect(previewD).not.toContain("prefers-color-scheme");
    });

    it("tło strony jest prawie czarne, a poświata ma granat i koral", () => {
      expect(luminance(dDark["bg-from"])).toBeLessThan(0.01);
      expect(luminance(dDark["bg-to"])).toBeLessThan(0.02);
      expect(previewD).toContain("--glow-navy: rgba(");
      expect(previewD).toContain("--glow-coral: rgba(");
    });
  });

  it("gradienty są zdefiniowane na tokenach (tło, nagłówek, akcent), a font to Noto Sans z pliku lokalnego", () => {
    expect(globals).toContain("--grad-bg: linear-gradient");
    expect(globals).toContain("--grad-head: linear-gradient");
    expect(globals).toContain("--grad-accent: linear-gradient");
    expect(globals).toContain("--font-noto-sans");
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain('from "next/font/local"');
    expect(layout).not.toContain("next/font/google");
    expect(layout).toContain("NotoSans-Regular.ttf");
    expect(layout).toContain("NotoSans-Bold.ttf");
  });
});
