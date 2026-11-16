import { COMPARE_MIN_ENTRIES, COMPARE_MIN_NON_EMPTY_BLOCKS } from "@/lib/ai/config";

// Komunikaty dla użytkownika (po polsku) dla porównania wariantów. W osobnym pliku, bo plik z "use server" może eksportować
// wyłącznie funkcje asynchroniczne.
export const COMPARE_NOT_FOUND_MESSAGE = "Nie znaleziono wszystkich wskazanych wariantów w projekcie.";
export const COMPARE_VALIDATION_MESSAGE = "Wybierz od 2 do 3 różnych wariantów do porównania.";
export const COMPARE_TOO_EMPTY_MESSAGE = `Każdy porównywany wariant musi mieć co najmniej ${COMPARE_MIN_ENTRIES} wpisy w co najmniej ${COMPARE_MIN_NON_EMPTY_BLOCKS} blokach. Uzupełnij puste warianty i spróbuj ponownie.`;
export const COMPARE_CONFIG_MESSAGE = "Agent jest źle skonfigurowany (model lub klucz API). Sprawdź konfigurację serwera.";
export const COMPARE_SCHEMA_MESSAGE =
  "Model zwrócił odpowiedź w niewłaściwym formacie, więc porównanie nie zostało zapisane. Spróbuj ponownie.";
// Model odpowiedział (zużył zapytanie z limitu), więc ponowienie liczy się do limitów.
export const COMPARE_SAVE_FAILED_MESSAGE = "Model odpowiedział, ale nie udało się zapisać porównania. Spróbuj ponownie";
export const COMPARE_FORBIDDEN_MESSAGE = "Nie masz uprawnień do porównywania wariantów w tym projekcie.";
export const COMPARE_READ_FORBIDDEN_MESSAGE = "Nie masz uprawnień do tego projektu.";
export const COMPARE_COMPARISON_NOT_FOUND_MESSAGE = "Nie znaleziono tego porównania.";
export const COMPARE_INVALID_ID_MESSAGE = "Nieprawidłowy identyfikator porównania.";
