import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Plan `docs/plan-design.md`: komponenty i strony używają wyłącznie tokenów wyglądu (`bg-surface`, `text-muted`, `bg-cta`…),
// bez surowych klas palety Tailwinda i bez wariantów `dark:` (aplikacja jest wyłącznie ciemna).
const RAW = /\b(?:hover:|focus:|disabled:|file:|aria-[a-z]+:)*(?:bg|text|border|ring|divide|decoration|outline|fill|stroke|from|via|to)-(?:zinc|red|amber|green|blue|sky|indigo|teal|gray|slate|neutral|stone|yellow|orange|violet|purple|pink|rose|emerald|cyan|lime|fuchsia)-\d/;
const BASIC = /\b(?:bg-white|text-white|bg-black|text-black)\b/;
const DARK = /(?:^|[\s"'`])dark:/;

function walk(dir: string): string[] {
  return readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function sourceFiles(): string[] {
  return [...walk("src/components"), ...walk("src/app")].filter((file) => file.endsWith(".tsx") && !file.includes(".test."));
}

describe("tokeny zamiast surowych kolorów", () => {
  const files = sourceFiles();

  it("znajduje pliki do sprawdzenia", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("żaden komponent ani strona nie używa surowych klas palety (zinc, red, amber, green, blue, …)", () => {
    const offenders = files.filter((file) => RAW.test(readFileSync(join(process.cwd(), file), "utf8")));

    expect(offenders).toEqual([]);
  });

  it("żaden komponent ani strona nie używa bg-white, text-white, bg-black ani text-black", () => {
    const offenders = files.filter((file) => BASIC.test(readFileSync(join(process.cwd(), file), "utf8")));

    expect(offenders).toEqual([]);
  });

  it("brak wariantów dark: (aplikacja jest wyłącznie ciemna)", () => {
    const offenders = files.filter((file) => DARK.test(readFileSync(join(process.cwd(), file), "utf8")));

    expect(offenders).toEqual([]);
  });
});
