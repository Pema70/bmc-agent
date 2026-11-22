import { describe, expect, it } from "vitest";
import { loadAttachmentLimits } from "@/lib/attachments/config";

describe("loadAttachmentLimits", () => {
  it("bez zmiennych zwraca wartości domyślne", () => {
    expect(loadAttachmentLimits({})).toEqual({
      maxBytes: 10 * 1024 * 1024,
      maxPerProject: 10,
      maxTextChars: 200_000,
      readMaxChars: 6_000,
      zipMaxUncompressedBytes: 100 * 1024 * 1024,
      zipMaxEntries: 1_000,
      pdfMaxPages: 200,
      extractTimeoutMs: 15_000,
      storageDir: ".data/attachments",
    });
  });

  it("czyta wartości ze zmiennych środowiskowych", () => {
    expect(
      loadAttachmentLimits({
        ATTACHMENT_MAX_BYTES: "2048",
        ATTACHMENT_MAX_PER_PROJECT: "3",
        ATTACHMENT_MAX_TEXT_CHARS: "5000",
        READ_ATTACHMENT_MAX_CHARS: "1000",
        ATTACHMENT_ZIP_MAX_UNCOMPRESSED_BYTES: "5242880",
        ATTACHMENT_ZIP_MAX_ENTRIES: "50",
        ATTACHMENT_PDF_MAX_PAGES: "20",
        ATTACHMENT_EXTRACT_TIMEOUT_MS: "5000",
        ATTACHMENTS_DIR: "D:/pliki",
      }),
    ).toEqual({
      maxBytes: 2048,
      maxPerProject: 3,
      maxTextChars: 5000,
      readMaxChars: 1000,
      zipMaxUncompressedBytes: 5242880,
      zipMaxEntries: 50,
      pdfMaxPages: 20,
      extractTimeoutMs: 5000,
      storageDir: "D:/pliki",
    });
  });

  it("pusta zmienna liczy się jak brak (wartość domyślna)", () => {
    const limits = loadAttachmentLimits({ ATTACHMENT_MAX_BYTES: "", ATTACHMENT_MAX_PER_PROJECT: "", ATTACHMENTS_DIR: "" });

    expect(limits.maxBytes).toBe(10 * 1024 * 1024);
    expect(limits.maxPerProject).toBe(10);
    expect(limits.storageDir).toBe(".data/attachments");
  });

  it.each([
    ["ATTACHMENT_MAX_BYTES", "10"],
    ["ATTACHMENT_MAX_BYTES", "999999999"],
    ["ATTACHMENT_MAX_PER_PROJECT", "0"],
    ["ATTACHMENT_MAX_TEXT_CHARS", "abc"],
    ["READ_ATTACHMENT_MAX_CHARS", "100"],
    ["READ_ATTACHMENT_MAX_CHARS", "1.5"],
    ["ATTACHMENT_ZIP_MAX_UNCOMPRESSED_BYTES", "10"],
    ["ATTACHMENT_ZIP_MAX_ENTRIES", "0"],
    ["ATTACHMENT_PDF_MAX_PAGES", "100000"],
    ["ATTACHMENT_EXTRACT_TIMEOUT_MS", "10"],
  ])("odrzuca poza zakresem lub nieliczbową wartość %s=%s", (name, value) => {
    expect(() => loadAttachmentLimits({ [name]: value })).toThrow("Niepoprawna konfiguracja załączników");
  });
});
