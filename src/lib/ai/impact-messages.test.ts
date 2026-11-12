import { describe, expect, it } from "vitest";
import { impactErrorMessage } from "@/lib/ai/impact-messages";

const SAVE_FAILED_MESSAGE = "Model odpowiedział, ale nie udało się zapisać analizy. Spróbuj ponownie";

describe("impactErrorMessage", () => {
  it.each([
    "FORBIDDEN",
    "VALIDATION",
    "NOT_FOUND",
    "STALE_PROPOSAL",
    "LIMIT",
    "TOO_EMPTY",
    "CONFIG",
    "SCHEMA",
    "PROVIDER",
    "SAVE_FAILED",
  ] as const)("%s ma niepusty polski komunikat także bez szczegółu", (code) => {
    const message = impactErrorMessage(code, "");
    expect(message.length).toBeGreaterThan(10);
  });

  it("dla błędów bez szczegółu ignoruje komunikat z wnętrza (np. SCHEMA, CONFIG, SAVE_FAILED)", () => {
    expect(impactErrorMessage("SAVE_FAILED", "inny tekst")).toBe(SAVE_FAILED_MESSAGE);
    expect(impactErrorMessage("CONFIG", "klucz=abc")).not.toContain("abc");
  });
});

