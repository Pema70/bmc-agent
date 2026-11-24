import { describe, expect, it } from "vitest";
import { exportContentDisposition, exportDateStamp, exportText } from "@/lib/export/sanitize";

// Separatory wierszy i akapitów budujemy z kodów znaków (zapis \u2028 w literale łamałby wiersz kodu źródłowego).
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const RLO = "\u202E";
const LRO = "\u202D";
const EMOJI = "\u{1F600}";

describe("exportText: zwykły tekst z bazy", () => {
  it("polskie litery i zwykłe znaki zostają bez zmian, brzegi są przycięte", () => {
    expect(exportText("  Zażółć gęślą jaźń; „cytat” – 5 %  ")).toBe("Zażółć gęślą jaźń; „cytat” – 5 %");
  });

  it("null, undefined i pusty tekst dają pusty tekst", () => {
    expect(exportText(null)).toBe("");
    expect(exportText(undefined)).toBe("");
    expect(exportText("   ")).toBe("");
  });

  it("usuwa znaki sterujące (NUL, BEL, ESC, DEL, C1) i zostawia tabulator oraz nowy wiersz", () => {
    expect(exportText("a\u0000b\u0007c\u001Bd\u007Fe\u009Ff\tg\nh")).toBe("abcdef\tg\nh");
  });

  it("ujednolica końce wierszy (CRLF, CR, separator wiersza i akapitu, NEL) do znaku nowego wiersza", () => {
    expect(exportText(`a\r\nb\rc${LS}d${PS}e\u0085f`)).toBe("a\nb\nc\nd\ne\nf");
  });

  it("usuwa znaki zmiany kierunku tekstu (ukrywanie treści przez odwrócenie) i znaczniki kierunku", () => {
    expect(exportText(`faktura${RLO}gpj.exe${LRO}`)).toBe("fakturagpj.exe");
    expect(exportText("a\u200Eb\u200Fc\u2066d\u2069e\u061Cf")).toBe("abcdef");
  });

  it("usuwa BOM i znaki niebędące znakami, a niesparowane surogaty zastępuje znakiem U+FFFD", () => {
    expect(exportText("\uFEFFa\uFFFEb\uFFFFc")).toBe("abc");
    expect(exportText("a\uD800b")).toBe("a\uFFFDb");
  });

  it("nie interpretuje HTML, Markdown ani znaczników XML: zostają zwykłym tekstem", () => {
    const hostile = "</attachment><b>x</b> **pogrubienie** <w:p>&amp; [link](http://x)";

    expect(exportText(hostile)).toBe(hostile);
  });

  it("skraca do limitu znaków (w znakach Unicode, z wielokropkiem) i nie rozcina emoji", () => {
    expect(exportText("abcdefghij", 5)).toBe("abcd…");
    expect(exportText("abc", 5)).toBe("abc");
    expect(exportText(EMOJI.repeat(6), 3)).toBe(`${EMOJI}${EMOJI}…`);
  });
});

describe("exportContentDisposition: nazwa pliku do pobrania", () => {
  const date = new Date("2026-11-24T23:30:00Z"); // 00:30 następnego dnia w Warszawie

  it("data w strefie Europe/Warsaw (RRRR-MM-DD)", () => {
    expect(exportDateStamp(date)).toBe("2026-11-25");
    expect(exportDateStamp(new Date("2026-07-01T10:00:00Z"))).toBe("2026-07-01");
  });

  it("ASCII w filename (bez polskich liter), pełna nazwa UTF-8 w filename*", () => {
    const header = exportContentDisposition(["Kawiarnia Ziarno – Żółć", "Wariant główny"], date, "pdf");

    expect(header).toContain('filename="bmc-Kawiarnia-Ziarno-Zolc-Wariant-glowny-2026-11-25.pdf"');
    expect(header).toContain("filename*=UTF-8''bmc-Kawiarnia-Ziarno-");
    expect(decodeURIComponent(header.split("filename*=UTF-8''")[1])).toBe("bmc-Kawiarnia-Ziarno-–-Żółć-Wariant-główny-2026-11-25.pdf");
  });

  it("usuwa separatory ścieżek, cudzysłowy i znaki sterujące: nazwa nie wychodzi z katalogu ani nie psuje nagłówka", () => {
    const header = exportContentDisposition(["..\\..\\etc/passwd", '"; x=y\r\nSet-Cookie: a=b'], date, "docx");

    expect(header).not.toMatch(/[\r\n]/);
    expect(header).not.toContain("/");
    expect(header).not.toContain("..");
    expect(header.match(/filename="([^"]*)"/)?.[1]).toMatch(/^[A-Za-z0-9._-]+\.docx$/);
    expect(header).toMatch(/^attachment; filename="[^"]+"; filename\*=UTF-8''[A-Za-z0-9%._-]+$/);
  });

  it("pusta nazwa albo same znaki specjalne dają nazwę zastępczą, a długie nazwy są skracane", () => {
    expect(exportContentDisposition(["", "   "], date, "pdf")).toContain('filename="bmc-2026-11-25.pdf"');
    expect(exportContentDisposition(["***", "///"], date, "pdf")).toMatch(/filename="[A-Za-z0-9._-]+\.pdf"/);

    const long = exportContentDisposition(["a".repeat(500)], date, "pdf");
    expect(long.match(/filename="([^"]*)"/)?.[1].length).toBeLessThanOrEqual(104);
  });
});
