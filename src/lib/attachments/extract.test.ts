import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDocx, buildPdf, buildZip } from "@/lib/attachments/build-test-files";
import { detectKind, extractText, sanitizeText, type ExtractLimits } from "@/lib/attachments/extract";

const MB = 1024 * 1024;
const limits: ExtractLimits = {
  maxTextChars: 10_000,
  zipMaxUncompressedBytes: MB,
  zipMaxEntries: 100,
  pdfMaxPages: 50,
  extractTimeoutMs: 15_000,
};

const bytes = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));
const LONG_TEXT = "Kawiarnia w centrum miasta sprzedaje kawe speciality. ";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("detectKind (po zawartości, rozszerzenie jako kontrola)", () => {
  it("rozpoznaje PDF, DOCX i TXT", () => {
    expect(detectKind(buildPdf([LONG_TEXT]), "opis.pdf")).toEqual({ ok: true, kind: "PDF" });
    expect(detectKind(buildDocx(["a"]), "opis.docx")).toEqual({ ok: true, kind: "DOCX" });
    expect(detectKind(bytes("Opis kawiarni."), "opis.txt")).toEqual({ ok: true, kind: "TXT" });
  });

  it("rozszerzenie bez względu na wielkość liter i ścieżkę w nazwie", () => {
    expect(detectKind(buildPdf([LONG_TEXT]), "../../OPIS.PDF")).toEqual({ ok: true, kind: "PDF" });
  });

  it("TXT z BOM UTF-8 jest poprawny", () => {
    expect(detectKind(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes("Zażółć")]), "a.txt")).toEqual({ ok: true, kind: "TXT" });
  });

  it.each([
    ["PDF pod nazwą .txt", buildPdf([LONG_TEXT]), "a.txt"],
    ["tekst pod nazwą .pdf", bytes("To tylko tekst."), "a.pdf"],
    ["DOCX pod nazwą .pdf", buildDocx(["a"]), "a.pdf"],
    ["tekst pod nazwą .docx", bytes("To tylko tekst."), "a.docx"],
    ["dane binarne (NUL) pod nazwą .txt", new Uint8Array([65, 0, 66, 0]), "a.txt"],
    ["tekst nie-UTF-8 pod nazwą .txt", new Uint8Array([0xff, 0xfe, 0xfd, 0x80]), "a.txt"],
    ["pusty plik .txt", new Uint8Array(0), "a.txt"],
  ])("odrzuca niezgodność: %s", (_name, content, fileName) => {
    expect(detectKind(content, fileName)).toMatchObject({ ok: false, error: "MISMATCH" });
  });

  it.each([["a.xlsx"], ["a"], ["a.exe"], ["a.pdf.exe"], [".."]])("nieobsługiwane rozszerzenie %j", (fileName) => {
    expect(detectKind(buildPdf([LONG_TEXT]), fileName)).toMatchObject({ ok: false, error: "UNSUPPORTED" });
  });
});

describe("sanitizeText", () => {
  it("usuwa NUL i znaki sterujące, normalizuje końce linii i puste linie", () => {
    expect(sanitizeText("a\u0000b\r\nc\r\r\n\n\n\nd\u0007  \ne")).toBe("ab\nc\n\nd\ne");
  });
});

describe("TXT", () => {
  it("wyciąga tekst (polskie znaki, CRLF zamienione na LF)", async () => {
    const result = await extractText({ kind: "TXT", bytes: bytes("Zażółć gęślą jaźń.\r\nKawiarnia w centrum miasta."), limits });

    expect(result).toEqual({ ok: true, text: "Zażółć gęślą jaźń.\nKawiarnia w centrum miasta.", truncated: false });
  });

  it("pusty lub prawie pusty tekst to NO_TEXT", async () => {
    expect(await extractText({ kind: "TXT", bytes: bytes("   \n  "), limits })).toMatchObject({ ok: false, error: "NO_TEXT" });
    expect(await extractText({ kind: "TXT", bytes: bytes("Ala"), limits })).toMatchObject({ ok: false, error: "NO_TEXT" });
  });

  it("tekst dłuższy niż limit jest przycięty z flagą", async () => {
    const result = await extractText({ kind: "TXT", bytes: bytes(LONG_TEXT.repeat(1000)), limits });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(limits.maxTextChars);
  });

  it("przycięcie nie rozcina pary zastępczej (emoji) na końcu", async () => {
    const text = "a".repeat(9_999) + "😀" + "b".repeat(50);
    const result = await extractText({ kind: "TXT", bytes: bytes(text), limits });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text.length).toBe(9_999);
    expect(result.text.endsWith("a")).toBe(true);
  });

  it("nie zwraca znaku NUL (w tym przy wywołaniu bezpośrednim z danymi binarnymi)", async () => {
    expect(await extractText({ kind: "TXT", bytes: new Uint8Array([65, 0, 66]), limits })).toMatchObject({
      ok: false,
      error: "UNSUPPORTED",
    });
  });
});

describe("PDF (unpdf)", () => {
  it("wyciąga tekst ze wszystkich stron", async () => {
    const result = await extractText({ kind: "PDF", bytes: buildPdf(["Kawiarnia w centrum miasta.", "Sprzedaz kawy i sniadan."]), limits });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain("Kawiarnia w centrum miasta.");
    expect(result.text).toContain("Sprzedaz kawy i sniadan.");
    expect(result.truncated).toBe(false);
  });

  it("nie niszczy bufora wejściowego (oryginał jeszcze trafia do magazynu)", async () => {
    const pdf = buildPdf([LONG_TEXT]);
    const copy = new Uint8Array(pdf);

    await extractText({ kind: "PDF", bytes: pdf, limits });

    expect(pdf.length).toBe(copy.length);
    expect(Buffer.compare(pdf, copy)).toBe(0);
  });

  it("limit stron: czyta tylko pierwsze strony i ustawia flagę przycięcia", async () => {
    const pages = [LONG_TEXT + "STRONA-1", LONG_TEXT + "STRONA-2", LONG_TEXT + "STRONA-3"];

    const result = await extractText({ kind: "PDF", bytes: buildPdf(pages), limits: { ...limits, pdfMaxPages: 2 } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain("STRONA-1");
    expect(result.text).toContain("STRONA-2");
    expect(result.text).not.toContain("STRONA-3");
    expect(result.truncated).toBe(true);
  });

  it("limit znaków: przycięcie z flagą i przerwanie czytania kolejnych stron", async () => {
    const pages = Array.from({ length: 5 }, (_, i) => LONG_TEXT.repeat(4) + `S${i + 1}`);

    const result = await extractText({ kind: "PDF", bytes: buildPdf(pages), limits: { ...limits, maxTextChars: 300 } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(300);
  });

  it("PDF bez warstwy tekstowej (skan) to NO_TEXT z jasnym komunikatem", async () => {
    const result = await extractText({ kind: "PDF", bytes: buildPdf([null, null]), limits });

    expect(result).toMatchObject({ ok: false, error: "NO_TEXT", message: expect.stringContaining("skan") });
  });

  it("uszkodzony PDF to CORRUPT", async () => {
    const broken = bytes("%PDF-1.4\nto nie jest poprawny dokument\n%%EOF");

    expect(await extractText({ kind: "PDF", bytes: broken, limits })).toMatchObject({ ok: false, error: "CORRUPT" });
  });

  it("ucięty PDF nie rzuca wyjątku: wynik to błąd albo to, co dało się odczytać", async () => {
    const pdf = buildPdf([LONG_TEXT]);

    const result = await extractText({ kind: "PDF", bytes: pdf.subarray(0, Math.floor(pdf.length / 2)), limits });

    expect(typeof result.ok).toBe("boolean");
  });

  it("limit czasu: po przekroczeniu terminu między stronami wynik to TIMEOUT", async () => {
    let calls = 0;
    // Pierwsze wywołanie ustala termin, kolejne „po terminie”.
    vi.spyOn(Date, "now").mockImplementation(() => (calls++ === 0 ? 0 : 10 * 60_000));

    const result = await extractText({
      kind: "PDF",
      bytes: buildPdf([LONG_TEXT, LONG_TEXT, LONG_TEXT]),
      limits: { ...limits, extractTimeoutMs: 1_000 },
    });

    expect(result).toMatchObject({ ok: false, error: "TIMEOUT" });
  });
});

describe("DOCX (mammoth) i ochrona przed „bombą ZIP”", () => {
  it("wyciąga tekst z akapitów (polskie znaki, znaki XML)", async () => {
    const result = await extractText({
      kind: "DOCX",
      bytes: buildDocx(["Kawiarnia „Ziarno” w centrum miasta.", "Śniadania & wypieki <świeże>."]),
      limits,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain("Kawiarnia „Ziarno” w centrum miasta.");
    expect(result.text).toContain("Śniadania & wypieki <świeże>.");
  });

  it("zbyt wiele plików w archiwum: ARCHIVE_TOO_LARGE", async () => {
    const docx = buildDocx(["Kawiarnia w centrum miasta, kawa i sniadania."], Array.from({ length: 150 }, (_, i) => ({ name: `x${i}.bin`, data: "x" })));

    expect(await extractText({ kind: "DOCX", bytes: docx, limits })).toMatchObject({ ok: false, error: "ARCHIVE_TOO_LARGE" });
  });

  it("bomba ZIP z uczciwym spisem (40 MB po rozpakowaniu, plik poniżej 1 MB): ARCHIVE_TOO_LARGE", async () => {
    const bomb = buildDocx(["Kawiarnia w centrum miasta, kawa i sniadania."], [{ name: "word/media/zera.bin", data: new Uint8Array(40 * MB) }]);

    expect(bomb.length).toBeLessThan(MB);
    expect(await extractText({ kind: "DOCX", bytes: bomb, limits })).toMatchObject({ ok: false, error: "ARCHIVE_TOO_LARGE" });
  });

  it("bomba ZIP ze sfałszowanym spisem (deklaruje 10 bajtów, w środku 20 MB): ARCHIVE_TOO_LARGE", async () => {
    const bomb = buildDocx(
      ["Kawiarnia w centrum miasta, kawa i sniadania."],
      [{ name: "word/media/zera.bin", data: new Uint8Array(20 * MB), declaredUncompressed: 10 }],
    );

    expect(await extractText({ kind: "DOCX", bytes: bomb, limits })).toMatchObject({ ok: false, error: "ARCHIVE_TOO_LARGE" });
  });

  it("limit rozpakowania jest z konfiguracji: ten sam plik przechodzi przy wyższym limicie", async () => {
    const docx = buildDocx(["Kawiarnia w centrum miasta, kawa i sniadania."], [{ name: "word/media/zera.bin", data: new Uint8Array(3 * MB) }]);

    expect(await extractText({ kind: "DOCX", bytes: docx, limits })).toMatchObject({ ok: false, error: "ARCHIVE_TOO_LARGE" });
    expect((await extractText({ kind: "DOCX", bytes: docx, limits: { ...limits, zipMaxUncompressedBytes: 10 * MB } })).ok).toBe(true);
  });

  it("ZIP, który nie jest DOCX (brak word/document.xml): UNSUPPORTED", async () => {
    const xlsxLike = buildZip([
      { name: "[Content_Types].xml", data: "<Types/>" },
      { name: "xl/workbook.xml", data: "<workbook/>" },
    ]);

    expect(await extractText({ kind: "DOCX", bytes: xlsxLike, limits })).toMatchObject({ ok: false, error: "UNSUPPORTED" });
  });

  it("szyfrowane archiwum: UNSUPPORTED; ucięty plik i DOCX bez tekstu: CORRUPT / NO_TEXT", async () => {
    const encrypted = buildZip([{ name: "word/document.xml", data: "x", encrypted: true }]);
    expect(await extractText({ kind: "DOCX", bytes: encrypted, limits })).toMatchObject({ ok: false, error: "UNSUPPORTED" });

    const docx = buildDocx(["Kawiarnia w centrum miasta, kawa i sniadania."]);
    expect(await extractText({ kind: "DOCX", bytes: docx.subarray(0, docx.length - 30), limits })).toMatchObject({ ok: false });

    expect(await extractText({ kind: "DOCX", bytes: buildDocx([""]), limits })).toMatchObject({ ok: false, error: "NO_TEXT" });
  });

  it("DOCX przekazany do mammoth tylko po przejściu kontroli archiwum (bomba nie dociera do biblioteki)", async () => {
    const bomb = buildDocx(["x"], [{ name: "word/media/zera.bin", data: new Uint8Array(50 * MB) }]);
    const started = Date.now();

    const result = await extractText({ kind: "DOCX", bytes: bomb, limits });

    expect(result).toMatchObject({ ok: false, error: "ARCHIVE_TOO_LARGE" });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
