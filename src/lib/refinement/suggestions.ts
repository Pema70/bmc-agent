import type { QuestionsOutput, SuggestionsGuard } from "@/lib/schemas/refinement";

/**
 * Strażnik podpowiedzi odpowiedzi (krok 7g). Kliknięta podpowiedź zapisuje się jako odpowiedź użytkownika, więc nie może być
 * twierdzeniem o jego firmie. Reguła jest przede wszystkim w prompcie (`questions-v1`); to druga linia obrony:
 * deterministyczna **heurystyka**, a nie gwarancja. Wykrywanie pierwszej osoby opiera się na wybranych formach czasowników
 * i nie łapie wszystkiego (np. innych czasowników, zaimków dzierżawczych, zdań bez czasownika, które są twierdzeniem).
 * Usuwa pojedyncze podpowiedzi (pytanie zostaje) i liczy, ile i dlaczego usunięto, żeby można było policzyć, jak często model
 * łamał regułę promptu. Podpowiedzi to opcjonalne podpowiedzi interfejsu (nie dane), więc w odróżnieniu od paczki poprawek
 * ich usunięcie nie kończy się błędem.
 */

export const SUGGESTION_MAX_CHARS = 40;

const DIGIT = /\d/;
// Wybrane formy czasowników w 1. osobie (l. poj. i mn.) typowe dla opisu własnej firmy. „wiem” celowo pominięte:
// „Jeszcze nie wiem” i „Nie wiem” są dozwolonymi, neutralnymi podpowiedziami.
const FIRST_PERSON = new RegExp(
  "(?<!\\p{L})(" +
    [
      "mam",
      "mamy",
      "jestem",
      "jesteśmy",
      "planuję",
      "planujemy",
      "robię",
      "robimy",
      "posiadam",
      "posiadamy",
      "korzystam",
      "korzystamy",
      "współpracuję",
      "współpracujemy",
      "używam",
      "używamy",
      "prowadzę",
      "prowadzimy",
      "oferuję",
      "oferujemy",
      "sprzedaję",
      "sprzedajemy",
      "zamierzam",
      "zamierzamy",
      "chcę",
      "chcemy",
      "potrafię",
      "potrafimy",
      "stosuję",
      "stosujemy",
    ].join("|") +
    ")(?!\\p{L})",
  "iu",
);
// „Tak” lub „Nie” z dalszym ciągiem po znaku interpunkcyjnym („Tak, ale częściowo”, „Nie, bo …”). Same „Tak”, „Nie” oraz
// „Nie dotyczy” (bez interpunkcji) są dozwolone.
const YES_NO_CONTINUATION = /^(tak|nie)\s*[,;:.\-–—]\s*\S/iu;

export type SuggestionViolation = keyof SuggestionsGuard["reasons"];

/** Powody, dla których podpowiedź nie przechodzi (może być kilka naraz); pusta lista = przechodzi. */
export function suggestionViolations(suggestion: string): SuggestionViolation[] {
  const text = suggestion.trim();
  const violations: SuggestionViolation[] = [];
  if (DIGIT.test(text)) {
    violations.push("digits");
  }
  if (Array.from(text).length > SUGGESTION_MAX_CHARS) {
    violations.push("length");
  }
  if (FIRST_PERSON.test(text)) {
    violations.push("firstPerson");
  }
  if (YES_NO_CONTINUATION.test(text)) {
    violations.push("yesNoContinuation");
  }
  return violations;
}

/**
 * Usuwa z pytań niedozwolone podpowiedzi i zwraca liczniki (ile wygenerował model, ile usunięto i z jakich powodów; powody
 * mogą się nakładać, więc ich suma bywa większa niż `removed`). Nie zmienia argumentu.
 */
export function sanitizeQuestions(output: QuestionsOutput): { questions: QuestionsOutput; guard: SuggestionsGuard } {
  const guard: SuggestionsGuard = {
    generated: 0,
    removed: 0,
    reasons: { digits: 0, length: 0, firstPerson: 0, yesNoContinuation: 0 },
  };

  const questions = output.questions.map((question) => ({
    ...question,
    suggestedAnswers: question.suggestedAnswers.filter((suggestion) => {
      guard.generated += 1;
      const violations = suggestionViolations(suggestion);
      if (violations.length === 0) {
        return true;
      }
      guard.removed += 1;
      for (const violation of violations) {
        guard.reasons[violation] += 1;
      }
      return false;
    }),
  }));

  return { questions: { questions }, guard };
}
