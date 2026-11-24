import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Czcionka nagłówków (Space Grotesk, SIL OFL 1.1): pliki niezmodyfikowane, sumy zgodne z `src/app/fonts/README.md`.
const dir = join(process.cwd(), "src/app/fonts");
const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

describe("Space Grotesk w repozytorium", () => {
  it("plik czcionki jest bajt w bajt taki jak w źródle (suma SHA-256, rozmiar)", () => {
    const font = readFileSync(join(dir, "SpaceGrotesk-Variable.ttf"));

    expect(font.byteLength).toBe(136_676);
    expect(sha(font)).toBe("acad6de1fc93436f5c0f1f4137751ef04f1aea3063e7036535970ffcfbd79f72");
  });

  it("licencja SIL OFL 1.1 leży obok pliku; suma po normalizacji końców linii (LF) zgadza się z oryginałem (oryginał ma CRLF: 564ce565…)", () => {
    const license = readFileSync(join(dir, "OFL.txt"), "utf8");

    expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(license).toContain("Space Grotesk Project Authors");
    expect(sha(license.replace(/\r\n/g, "\n"))).toBe("c6dec685825f73b18c20926fddc65e8315642e12986f15db0699170940a09efc");
  });

  it("README zawiera sumy i źródło; layout ładuje czcionkę lokalnie jako --font-grotesk, bez sieci", () => {
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");

    expect(readme).toContain("acad6de1fc93436f5c0f1f4137751ef04f1aea3063e7036535970ffcfbd79f72");
    expect(readme).toContain("564ce565c371c5e5bbf286006565a7c9aa55a9f56e7ca58d56e05d649dd61a72");
    expect(readme).toContain("google/fonts");
    expect(layout).toContain('variable: "--font-grotesk"');
    expect(layout).toContain("./fonts/SpaceGrotesk-Variable.ttf");
    expect(layout).toContain('weight: "300 700"');
    expect(layout).not.toContain("next/font/google");
  });
});
