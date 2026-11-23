import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Kontrola zależności ekstrakcji (krok 7b): dokładne wersje, @xmldom/xmldom 0.8.15 (0.8.11 do 0.8.14 są oznaczone
// przez autora jako „critical issues”) i brak skryptów instalacyjnych w tych pakietach.

type LockPackage = { version?: string; hasInstallScript?: boolean };
const root = (path: string) => new URL(`../../../${path}`, import.meta.url);
const pkg = JSON.parse(readFileSync(root("package.json"), "utf8")) as { dependencies: Record<string, string> };
const lock = JSON.parse(readFileSync(root("package-lock.json"), "utf8")) as { packages: Record<string, LockPackage> };

describe("zależności ekstrakcji tekstu", () => {
  it("unpdf i mammoth są przypięte do dokładnych wersji", () => {
    expect(pkg.dependencies.unpdf).toBe("1.9.1");
    expect(pkg.dependencies.mammoth).toBe("1.13.0");
  });

  it("@xmldom/xmldom (zależność przechodnia mammoth) to 0.8.15", () => {
    expect(lock.packages["node_modules/@xmldom/xmldom"]?.version).toBe("0.8.15");
  });

  it("żaden z pakietów ekstrakcji ani ich zależności przechodnich nie ma skryptów instalacyjnych", () => {
    const names = [
      "unpdf",
      "mammoth",
      "@xmldom/xmldom",
      "argparse",
      "base64-js",
      "dingbat-to-unicode",
      "jszip",
      "lop",
      "underscore",
      "xmlbuilder",
      "lie",
      "pako",
      "readable-stream",
      "setimmediate",
    ];
    for (const name of names) {
      const entries = Object.entries(lock.packages).filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`));
      expect(entries.length, `brak ${name} w package-lock.json`).toBeGreaterThan(0);
      for (const [path, meta] of entries) {
        expect(meta.hasInstallScript, path).not.toBe(true);
      }
    }
  });
});
