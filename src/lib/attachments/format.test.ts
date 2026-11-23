import { describe, expect, it } from "vitest";
import { formatFileSize, uploadErrorMessage, UPLOAD_GENERIC_ERROR } from "@/lib/attachments/format";

describe("formatFileSize", () => {
  it("bajty, kilobajty i megabajty", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(340 * 1024)).toBe("340 KB");
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2,0 MB");
  });
});

describe("uploadErrorMessage", () => {
  it("bierze komunikat z odpowiedzi serwera", () => {
    expect(uploadErrorMessage({ ok: false, error: "TOO_LARGE", message: "Plik jest za duży." })).toBe("Plik jest za duży.");
  });

  it("nieznany kształt lub zbyt długi tekst daje komunikat ogólny", () => {
    expect(uploadErrorMessage(null)).toBe(UPLOAD_GENERIC_ERROR);
    expect(uploadErrorMessage({ message: 5 })).toBe(UPLOAD_GENERIC_ERROR);
    expect(uploadErrorMessage({ message: "x".repeat(301) })).toBe(UPLOAD_GENERIC_ERROR);
  });
});
