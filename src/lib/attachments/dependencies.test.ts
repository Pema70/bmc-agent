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

// Krok 9b: biblioteki eksportu. Instalacja z `--before` (wersje i ich zalezności przechodnie sprzed progu 14 dni), `--ignore-scripts`.
describe("zaleznosci eksportu PDF i DOCX (krok 9b)", () => {
  it("@react-pdf/renderer i docx sa przypiete do dokladnych wersji", () => {
    expect(pkg.dependencies["@react-pdf/renderer"]).toBe("4.9.0");
    expect(pkg.dependencies.docx).toBe("9.15.3");
    expect(lock.packages["node_modules/@react-pdf/renderer"]?.version).toBe("4.9.0");
    expect(lock.packages["node_modules/docx"]?.version).toBe("9.15.3");
  });

  it("w calym lockfile tylko znane pakiety Prismy i fsevents maja skrypty instalacyjne (zadna zaleznosc eksportu ich nie ma)", () => {
    const withScripts = Object.entries(lock.packages)
      .filter(([path, meta]) => path !== "" && meta.hasInstallScript === true)
      .map(([path]) => path)
      .sort();

    expect(withScripts).toEqual(["node_modules/@prisma/engines", "node_modules/fsevents", "node_modules/prisma"]);
  });

  it("wersja Reacta bez zmian (19.3.0), a docx ma wlasna, zagniezdzona kopie @types/node 26 (projekt: 22)", () => {
    expect(lock.packages["node_modules/react"]?.version).toBe("19.3.0");
    expect(lock.packages["node_modules/react-dom"]?.version).toBe("19.3.0");
    expect(lock.packages["node_modules/@types/node"]?.version).toMatch(/^22\./);
    expect(lock.packages["node_modules/docx/node_modules/@types/node"]?.version).toMatch(/^26\./);
  });
});

// Krok 10a: runner skryptu seeda. jiti jest jawną zależnością deweloperską (wcześniej tylko przechodnią); tsx odrzucony (postinstall w esbuild).
describe("jiti: runner seeda (krok 10a)", () => {
  const devPkg = JSON.parse(readFileSync(root("package.json"), "utf8")) as {
    devDependencies: Record<string, string>;

  };

  it("jiti jest przypięty do dokładnej wersji 2.7.0 w devDependencies i w lockfile", () => {
    expect(devPkg.devDependencies.jiti).toBe("2.7.0");
    expect(lock.packages["node_modules/jiti"]?.version).toBe("2.7.0");
  });

  it("jiti nie ma skryptu instalacyjnego ani zależności", () => {
    const entry = lock.packages["node_modules/jiti"] as { hasInstallScript?: boolean; dependencies?: unknown };
    expect(entry.hasInstallScript).not.toBe(true);
    expect(entry.dependencies).toBeUndefined();
  });

  it("prisma.config.ts uruchamia seed przez jiti", () => {
    const config = readFileSync(root("prisma.config.ts"), "utf8");
    expect(config).toContain('seed: "jiti prisma/seed.ts"');
  });
});

// Krok 10c: @ai-sdk/anthropic (tylko sędzia). Wersja z tej samej „partii” co ai i @ai-sdk/google: zależy dokładnie od
// tych samych @ai-sdk/provider i @ai-sdk/provider-utils, więc w lockfile nie ma zagnieżdżonych drugich kopii.
describe("@ai-sdk/anthropic (krok 10c)", () => {
  type AiLockPackage = LockPackage & { dependencies?: Record<string, string> };
  const packages = lock.packages as Record<string, AiLockPackage>;
  const anthropic = packages["node_modules/@ai-sdk/anthropic"];

  it("jest przypięty do dokładnej wersji 4.0.89 w package.json i w lockfile", () => {
    expect(pkg.dependencies["@ai-sdk/anthropic"]).toBe("4.0.89");
    expect(anthropic?.version).toBe("4.0.89");
  });

  it("nie ma skryptu instalacyjnego", () => {
    expect(anthropic?.hasInstallScript).not.toBe(true);
  });

  it("używa tych samych @ai-sdk/provider i @ai-sdk/provider-utils co ai i @ai-sdk/google (jedna kopia każdego)", () => {
    const provider = packages["node_modules/@ai-sdk/provider"]?.version;
    const utils = packages["node_modules/@ai-sdk/provider-utils"]?.version;

    expect(anthropic?.dependencies).toEqual({ "@ai-sdk/provider": provider, "@ai-sdk/provider-utils": utils });
    expect(packages["node_modules/ai"]?.dependencies?.["@ai-sdk/provider"]).toBe(provider);
    expect(packages["node_modules/@ai-sdk/google"]?.dependencies?.["@ai-sdk/provider-utils"]).toBe(utils);
    const copies = Object.keys(packages).filter((path) => /node_modules\/@ai-sdk\/provider(-utils)?$/.test(path));
    expect(copies.sort()).toEqual(["node_modules/@ai-sdk/provider", "node_modules/@ai-sdk/provider-utils"]);
  });

  it("pakiet @ai-sdk/openai nie jest zainstalowany (OpenAI nie jest obsługiwane)", () => {
    expect(packages["node_modules/@ai-sdk/openai"]).toBeUndefined();
    expect(pkg.dependencies["@ai-sdk/openai"]).toBeUndefined();
  });
});
