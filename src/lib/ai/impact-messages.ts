import type { ImpactErrorCode } from "@/lib/ai/impact";

export type AnalyzeImpactActionErrorCode = ImpactErrorCode | "FORBIDDEN";

// Komunikaty dla użytkownika. LIMIT, PROVIDER, STALE_PROPOSAL i TOO_EMPTY niosą szczegół (czas oczekiwania,
// rodzaj błędu dostawcy, powód nieaktualności), więc dla nich używamy komunikatu z runImpactAnalysis,
// a poniższy tekst jest zapasowy.
export const FALLBACK_MESSAGES: Record<AnalyzeImpactActionErrorCode, string> = {
  FORBIDDEN: "Nie masz uprawnień do analizowania wpływu zmian w tym projekcie.",
  VALIDATION: "Nieprawidłowy opis zmiany. Wybierz blok i opisz zmianę w 5-500 znakach.",
  NOT_FOUND: "Nie znaleziono tego wariantu lub oczekującej propozycji w projekcie.",
  STALE_PROPOSAL: "Tej propozycji nie da się już zastosować do aktualnego płótna, więc nie ma czego analizować.",
  LIMIT: "Przekroczono limit zapytań do modelu. Spróbuj ponownie później.",
  TOO_EMPTY: "Model jest jeszcze zbyt pusty do analizy wpływu. Dodaj więcej wpisów w co najmniej dwóch blokach.",
  CONFIG: "Agent jest źle skonfigurowany (model lub klucz API). Sprawdź konfigurację serwera.",
  SCHEMA: "Model zwrócił odpowiedź w niewłaściwym formacie, więc analiza nie została zapisana. Spróbuj ponownie.",
  PROVIDER: "Nie udało się uzyskać odpowiedzi od modelu. Spróbuj ponownie za chwilę.",
  SAVE_FAILED: "Model odpowiedział, ale nie udało się zapisać analizy. Spróbuj ponownie",
};

const PASS_THROUGH: ReadonlySet<ImpactErrorCode> = new Set(["LIMIT", "PROVIDER", "STALE_PROPOSAL", "TOO_EMPTY"]);

/** Polski komunikat dla błędu analizy: szczegółowy z runImpactAnalysis tam, gdzie niesie informację, w pozostałych stały. */
export function impactErrorMessage(error: AnalyzeImpactActionErrorCode, message: string): string {
  if (error !== "FORBIDDEN" && PASS_THROUGH.has(error) && message.trim() !== "") {
    return message;
  }
  return FALLBACK_MESSAGES[error];
}
