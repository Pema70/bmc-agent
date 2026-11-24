import { describe, expect, it } from "vitest";
import { SUGGESTION_MAX_CHARS, sanitizeQuestions, suggestionViolations } from "@/lib/refinement/suggestions";
import { QuestionsOutput } from "@/lib/schemas/refinement";

describe("suggestionViolations: dozwolone podpowiedzi", () => {
  it.each([
    "Tak",
    "Nie",
    "Nie dotyczy",
    "Jeszcze nie wiem",
    "Nie wiem",
    "Brak planu",
    "Wydarzenia tematyczne",
    "Osoby prywatne",
    "Negocjacje długoterminowych umów",
    "Współpraca z lokalnymi firmami",
    "Działania w mediach społecznościowych",
  ])("„%s” przechodzi", (suggestion) => {
    expect(suggestionViolations(suggestion)).toEqual([]);
  });
});

describe("suggestionViolations: powody odrzucenia", () => {
  it("cyfry", () => {
    expect(suggestionViolations("Sprzedaż za 5000 zł")).toEqual(["digits"]);
    expect(suggestionViolations("Do 3 miesięcy")).toEqual(["digits"]);
  });

  it(`długość ponad ${SUGGESTION_MAX_CHARS} znaków (liczone w znakach Unicode, nie w jednostkach UTF-16)`, () => {
    expect(suggestionViolations("a".repeat(SUGGESTION_MAX_CHARS))).toEqual([]);
    expect(suggestionViolations("a".repeat(SUGGESTION_MAX_CHARS + 1))).toEqual(["length"]);
    expect(suggestionViolations("😀".repeat(SUGGESTION_MAX_CHARS))).toEqual([]);
  });

  it("pierwsza osoba: wybrane formy czasowników, także z polskimi literami i wielkimi literami", () => {
    for (const suggestion of [
      "Mam alternatywnych dostawców",
      "Jesteśmy zależni od jednego dostawcy",
      "Planuję otworzyć drugi lokal",
      "Korzystamy z lokalnej palarni",
      "Współpracujemy z piekarnią",
      "Posiadam doświadczenie",
      "Nie mam planu",
    ]) {
      expect(suggestionViolations(suggestion)).toContain("firstPerson");
    }
  });

  it("pierwsza osoba nie łapie części wyrazów („mamusia”, „jestematyczny” to nie formy czasowników)", () => {
    expect(suggestionViolations("Mamusie z dziećmi")).toEqual([]);
    expect(suggestionViolations("Programy partnerskie")).toEqual([]);
  });

  it("„Tak” lub „Nie” z dalszym ciągiem po interpunkcji", () => {
    expect(suggestionViolations("Tak, ale tylko częściowo")).toEqual(["yesNoContinuation"]);
    expect(suggestionViolations("Nie: brak czasu")).toEqual(["yesNoContinuation"]);
    expect(suggestionViolations("Nie - bo drogo")).toEqual(["yesNoContinuation"]);
    expect(suggestionViolations("Tak.")).toEqual([]);
  });

  it("dwie podpowiedzi z kroku 0b (próba 1) są odrzucone, a powody mogą się nakładać", () => {
    expect(suggestionViolations("Tak, mam alternatywne opcje")).toEqual(["firstPerson", "yesNoContinuation"]);
    expect(suggestionViolations("Nie, jestem zależny od obecnych partnerów")).toEqual(["length", "firstPerson", "yesNoContinuation"]);
  });
});

describe("sanitizeQuestions", () => {
  const question = (suggestedAnswers: string[]) => ({
    blockKey: "channels" as const,
    criterion: "risk_resilience" as const,
    question: "Pytanie?",
    suggestedAnswers,
  });
  const output = (...answers: string[][]): QuestionsOutput => ({ questions: answers.map(question) });

  it("usuwa tylko niedozwolone podpowiedzi, pytania zostają w tej samej kolejności", () => {
    const result = sanitizeQuestions(output(["Tak", "Tak, mam wszystko"], ["Wydarzenia tematyczne"], []));

    expect(result.questions.questions.map((q) => q.suggestedAnswers)).toEqual([["Tak"], ["Wydarzenia tematyczne"], []]);
    expect(result.questions.questions).toHaveLength(3);
  });

  it("liczy wygenerowane i usunięte podpowiedzi oraz powody (powody mogą się nakładać)", () => {
    const result = sanitizeQuestions(
      output(["Tak, mam alternatywne opcje", "Jeszcze nie wiem"], ["Nie, jestem zależny od obecnych partnerów", "Za 5 zł"], ["Osoby prywatne"]),
    );

    expect(result.guard).toEqual({
      generated: 5,
      removed: 3,
      reasons: { digits: 1, length: 1, firstPerson: 2, yesNoContinuation: 2 },
    });
  });

  it("czyste podpowiedzi: zero usuniętych, liczniki zerowe", () => {
    const result = sanitizeQuestions(output(["Tak", "Nie"], ["Jeszcze nie wiem"], []));

    expect(result.guard).toEqual({ generated: 3, removed: 0, reasons: { digits: 0, length: 0, firstPerson: 0, yesNoContinuation: 0 } });
  });

  it("nie zmienia argumentu", () => {
    const input = output(["Tak, mam wszystko", "Tak"], [], []);
    const snapshot = JSON.stringify(input);

    sanitizeQuestions(input);

    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("wynik nadal spełnia schemat odpowiedzi (3 do 5 pytań)", () => {
    const result = sanitizeQuestions(output(["Tak, mam"], ["x"], []));

    expect(QuestionsOutput.safeParse(result.questions).success).toBe(true);
  });
});
