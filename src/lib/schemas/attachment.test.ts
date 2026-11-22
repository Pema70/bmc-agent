import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_FILE_NAME_MAX_CHARS,
  AttachmentFileName,
  CreateAttachmentInput,
  ReadAttachmentOutput,
  ReadAttachmentToolInput,
  attachmentLabel,
  normalizeFileName,
  parseAttachmentLabel,
} from "@/lib/schemas/attachment";

describe("normalizeFileName (nazwa pliku to niezaufany tekst)", () => {
  it.each([
    ["../../x.pdf", "x.pdf"],
    ["C:\\Users\\ktos\\plik.docx", "plik.docx"],
    ["/etc/passwd", "passwd"],
    ["  Opis   kawiarni.txt  ", "Opis kawiarni.txt"],
    ["raport\n2026\t.pdf", "raport 2026 .pdf"],
    ["plik\u0000.pdf", "plik .pdf"],
    ["a\u202Eb.pdf", "ab.pdf"],
    ["Zażółć gęślą jaźń.pdf", "Zażółć gęślą jaźń.pdf"],
  ])("%j daje %j", (raw, expected) => {
    expect(normalizeFileName(raw)).toBe(expected);
  });

  it.each([[""], ["."], [".."], ["..."], ["   "], ["a/"]])("nazwa %j jest pusta po normalizacji", (raw) => {
    expect(normalizeFileName(raw)).toBe("");
  });

  it("przycina do 200 znaków (liczonych jako znaki, nie jednostki UTF-16)", () => {
    const long = "ą".repeat(500) + ".pdf";

    expect(Array.from(normalizeFileName(long))).toHaveLength(ATTACHMENT_FILE_NAME_MAX_CHARS);
  });

  it("zachowuje nawiasy kątowe (escapuje je dopiero dataBlock), ale ukośnik zawsze ucina początek nazwy", () => {
    expect(normalizeFileName("<attachment name=x>.pdf")).toBe("<attachment name=x>.pdf");
    expect(normalizeFileName("</attachment><b>x</b>.pdf")).toBe("b>.pdf");
  });

  it("AttachmentFileName normalizuje i odrzuca pustą nazwę", () => {
    expect(AttachmentFileName.parse("../a.pdf")).toBe("a.pdf");
    expect(AttachmentFileName.safeParse("..").success).toBe(false);
    expect(AttachmentFileName.safeParse(42).success).toBe(false);
  });
});

describe("etykiety załączników Z{n}", () => {
  it("attachmentLabel i parseAttachmentLabel są odwrotne", () => {
    expect(attachmentLabel(3)).toBe("Z3");
    expect(parseAttachmentLabel("Z3")).toBe(3);
    expect(parseAttachmentLabel(attachmentLabel(123456))).toBe(123456);
  });

  it("toleruje małą literę i białe znaki dookoła", () => {
    expect(parseAttachmentLabel("z12")).toBe(12);
    expect(parseAttachmentLabel("  Z7 ")).toBe(7);
  });

  it.each([[""], ["Z"], ["Z0"], ["Z01"], ["X1"], ["Z1a"], ["Z-1"], ["Z1234567890"], ["cm1234567890abcdefghijklm"]])(
    "%j nie jest etykietą",
    (value) => {
      expect(parseAttachmentLabel(value)).toBeNull();
    },
  );
});

describe("ReadAttachmentToolInput (schemat widziany przez model)", () => {
  it("przyjmuje etykietę bez offset, z null i z liczbą", () => {
    expect(ReadAttachmentToolInput.safeParse({ attachmentId: "Z1" }).success).toBe(true);
    expect(ReadAttachmentToolInput.safeParse({ attachmentId: "Z1", offset: null }).success).toBe(true);
    expect(ReadAttachmentToolInput.safeParse({ attachmentId: "Z1", offset: 6000 }).success).toBe(true);
  });

  it.each([
    [{ offset: 0 }],
    [{ attachmentId: "" }],
    [{ attachmentId: "Z1", offset: -1 }],
    [{ attachmentId: "Z1", offset: 1.5 }],
    [{ attachmentId: "Z1", offset: 99_999_999 }],
    [{ attachmentId: "a".repeat(21) }],
  ])("odrzuca %j", (input) => {
    expect(ReadAttachmentToolInput.safeParse(input).success).toBe(false);
  });
});

describe("ReadAttachmentOutput", () => {
  it("przyjmuje wynik ok z nextOffset liczbą albo null oraz błąd", () => {
    expect(ReadAttachmentOutput.safeParse({ ok: true, content: "x", totalChars: 10, nextOffset: 6 }).success).toBe(true);
    expect(ReadAttachmentOutput.safeParse({ ok: true, content: "x", totalChars: 1, nextOffset: null }).success).toBe(true);
    expect(ReadAttachmentOutput.safeParse({ ok: false, error: "Nie znaleziono załącznika." }).success).toBe(true);
  });

  it("odrzuca wynik ok bez treści", () => {
    expect(ReadAttachmentOutput.safeParse({ ok: true, totalChars: 1, nextOffset: null }).success).toBe(false);
  });
});

describe("CreateAttachmentInput", () => {
  const valid = {
    projectId: "p1",
    createdById: "u1",
    fileName: "../Opis.pdf",
    kind: "PDF" as const,
    sizeBytes: 1000,
    storageKey: "A".repeat(32),
    extractedText: "Kawiarnia w centrum miasta.",
    truncated: false,
  };

  it("przyjmuje poprawne dane i normalizuje nazwę pliku", () => {
    expect(CreateAttachmentInput.parse(valid)).toMatchObject({ fileName: "Opis.pdf", kind: "PDF" });
  });

  it("przyjmuje createdById równe null", () => {
    expect(CreateAttachmentInput.safeParse({ ...valid, createdById: null }).success).toBe(true);
  });

  it.each([
    ["pusty tekst", { extractedText: "" }],
    ["tekst z samych białych znaków", { extractedText: " \n\t " }],
    ["tekst ze znakiem NUL", { extractedText: "abc\u0000def" }],
    ["klucz magazynu z ..", { storageKey: "../" + "a".repeat(29) }],
    ["rozmiar zero", { sizeBytes: 0 }],
    ["rozmiar powyżej twardego limitu", { sizeBytes: 60 * 1024 * 1024 }],
    ["nieznany rodzaj", { kind: "XLSX" }],
    ["pusta nazwa po normalizacji", { fileName: ".." }],
  ])("odrzuca: %s", (_name, override) => {
    expect(CreateAttachmentInput.safeParse({ ...valid, ...override }).success).toBe(false);
  });
});
