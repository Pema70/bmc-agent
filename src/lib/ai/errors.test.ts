import { APICallError, LoadAPIKeyError, RetryError, StreamProviderError } from "ai";
import { describe, expect, it } from "vitest";
import { classifyLlmError, toUserFacingError } from "@/lib/ai/errors";

function apiError(statusCode: number): APICallError {
  return new APICallError({
    message: "Treść błędu dostawcy z adresem https://tajny.example/?key=SEKRET",
    url: "https://tajny.example/?key=SEKRET",
    requestBodyValues: { prompt: "dane projektu" },
    statusCode,
  });
}

describe("classifyLlmError", () => {
  it("429 z API daje limit dostawcy", () => {
    expect(classifyLlmError(apiError(429))).toMatchObject({
      kind: "RATE_LIMIT",
      status: "PROVIDER_RATE_LIMIT",
      errorCode: "429",
    });
  });

  it("429 w strumieniu (StreamProviderError) też daje limit dostawcy", () => {
    const error = new StreamProviderError({ message: "RESOURCE_EXHAUSTED", statusCode: 429, isRetryable: true });

    expect(classifyLlmError(error).kind).toBe("RATE_LIMIT");
  });

  it("rozpakowuje RetryError do ostatniego błędu", () => {
    const last = apiError(429);
    const error = new RetryError({ message: "Po 3 próbach", reason: "maxRetriesExceeded", errors: [last, last, last] });

    expect(classifyLlmError(error)).toMatchObject({ kind: "RATE_LIMIT", errorCode: "429" });
  });

  it("401 i 403 to błąd klucza API", () => {
    expect(classifyLlmError(apiError(401))).toMatchObject({ kind: "AUTH", errorCode: "401", status: "ERROR" });
    expect(classifyLlmError(apiError(403)).kind).toBe("AUTH");
  });

  it("brakujący klucz to błąd konfiguracji", () => {
    expect(classifyLlmError(new LoadAPIKeyError({ message: "brak klucza" })).kind).toBe("CONFIG");
  });

  it("przekroczenie czasu i przerwanie to TIMEOUT", () => {
    expect(classifyLlmError(Object.assign(new Error("x"), { name: "TimeoutError" })).kind).toBe("TIMEOUT");
    expect(classifyLlmError(apiError(504)).kind).toBe("TIMEOUT");
  });

  it("nieznany błąd daje ogólny komunikat i kod z nazwy błędu", () => {
    expect(classifyLlmError(new TypeError("coś"))).toMatchObject({ kind: "UNKNOWN", errorCode: "TypeError" });
    expect(classifyLlmError("tekst")).toMatchObject({ kind: "UNKNOWN", errorCode: "UNKNOWN" });
  });
});

describe("toUserFacingError", () => {
  it("zwraca polski komunikat bez treści błędu dostawcy, adresów i kluczy", () => {
    const message = toUserFacingError(apiError(429));

    expect(message).toBe("Przekroczono limit zapytań modelu (darmowy plan). Spróbuj ponownie za chwilę.");
    expect(message).not.toContain("SEKRET");
    expect(message).not.toContain("tajny.example");
  });

  it("kod błędu w logu nie zawiera komunikatu dostawcy", () => {
    expect(classifyLlmError(apiError(500)).errorCode).toBe("500");
  });
});
