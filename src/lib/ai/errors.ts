import { APICallError, LoadAPIKeyError, RetryError, StreamProviderError } from "ai";
import type { LlmCallStatus } from "@/generated/prisma/client";

export type LlmErrorKind = "RATE_LIMIT" | "UNAVAILABLE" | "AUTH" | "TIMEOUT" | "CONFIG" | "UNKNOWN";

export type ClassifiedLlmError = {
  kind: LlmErrorKind;
  status: LlmCallStatus;
  /** Krótki kod do LlmCallLog.errorCode: status HTTP lub typ błędu, bez treści komunikatu dostawcy. */
  errorCode: string;
  /** Polski komunikat bezpieczny dla użytkownika. */
  message: string;
};

const MESSAGES: Record<LlmErrorKind, string> = {
  RATE_LIMIT: "Przekroczono limit zapytań modelu (darmowy plan). Spróbuj ponownie za chwilę.",
  UNAVAILABLE: "Model jest chwilowo niedostępny (przeciążenie dostawcy). Spróbuj ponownie za chwilę.",
  AUTH: "Model odrzucił zapytanie: klucz API jest błędny lub nie ma uprawnień. Sprawdź konfigurację serwera.",
  TIMEOUT: "Model nie odpowiedział na czas. Spróbuj ponownie.",
  CONFIG: "Agent jest źle skonfigurowany (model lub klucz API). Sprawdź konfigurację serwera.",
  UNKNOWN: "Nie udało się uzyskać odpowiedzi od agenta. Spróbuj ponownie.",
};

function statusCodeOf(error: unknown): number | undefined {
  if (APICallError.isInstance(error) || StreamProviderError.isInstance(error)) {
    return error.statusCode;
  }
  return undefined;
}

/**
 * Klasyfikuje błąd wywołania modelu. Szczegóły (treść odpowiedzi dostawcy, adresy URL) zostają
 * tylko w logu serwera; użytkownik i LlmCallLog dostają krótki kod i ogólny komunikat.
 */
export function classifyLlmError(error: unknown): ClassifiedLlmError {
  // Po wyczerpaniu ponowień SDK opakowuje ostatni błąd w RetryError.
  const cause = RetryError.isInstance(error) ? error.lastError : error;

  if (LoadAPIKeyError.isInstance(cause)) {
    return { kind: "CONFIG", status: "ERROR", errorCode: "CONFIG", message: MESSAGES.CONFIG };
  }

  const statusCode = statusCodeOf(cause);
  if (statusCode === 429) {
    return { kind: "RATE_LIMIT", status: "PROVIDER_RATE_LIMIT", errorCode: "429", message: MESSAGES.RATE_LIMIT };
  }
  if (statusCode === 503 || statusCode === 502) {
    return { kind: "UNAVAILABLE", status: "ERROR", errorCode: String(statusCode), message: MESSAGES.UNAVAILABLE };
  }
  if (statusCode === 401 || statusCode === 403) {
    return { kind: "AUTH", status: "ERROR", errorCode: String(statusCode), message: MESSAGES.AUTH };
  }
  if (statusCode === 408 || statusCode === 504) {
    return { kind: "TIMEOUT", status: "ERROR", errorCode: String(statusCode), message: MESSAGES.TIMEOUT };
  }
  if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
    return { kind: "TIMEOUT", status: "ERROR", errorCode: cause.name, message: MESSAGES.TIMEOUT };
  }

  const errorCode = statusCode !== undefined ? String(statusCode) : cause instanceof Error ? cause.name : "UNKNOWN";
  return { kind: "UNKNOWN", status: "ERROR", errorCode, message: MESSAGES.UNKNOWN };
}

export function toUserFacingError(error: unknown): string {
  return classifyLlmError(error).message;
}
