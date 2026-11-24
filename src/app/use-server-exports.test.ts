import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Next.js (Turbopack) dopuszcza w pliku z dyrektywą "use server" wyłącznie eksporty funkcji asynchronicznych (oraz typów).
// Vitest tego nie sprawdza, więc błąd wychodził dopiero w `npm run build` (np. `export const KOMUNIKAT = ...`).

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const root = join(process.cwd(), "src");
const useServerFiles = sourceFiles(root).filter((path) => /^\s*(["'])use server\1/.test(readFileSync(path, "utf8")));

describe('pliki z dyrektywą "use server"', () => {
  it("są znalezione (test nie jest pusty)", () => {
    expect(useServerFiles.length).toBeGreaterThan(5);
  });

  it.each(useServerFiles.map((path) => [path.slice(root.length + 1).replaceAll("\\", "/"), path]))(
    "%s eksportuje wyłącznie funkcje async i typy",
    (_name, path) => {
      const offending = readFileSync(path, "utf8")
        .split(/\r?\n/)
        .filter((line) => /^export\s/.test(line))
        .filter((line) => !/^export\s+(async\s+function\s|type\s|interface\s)/.test(line));

      expect(offending).toEqual([]);
    },
  );
});
