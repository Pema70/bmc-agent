import type { EvaluationCriterion } from "@/lib/schemas/evaluation";

/**
 * Rubryka ręcznej oceny: te same definicje i progi co w prompcie `evaluate-v1`, żeby ocena ręczna i ocena AI były
 * porównywalne. Prompt jest osobnym tekstem (bez zmian w tym kroku), więc `rubric.test.ts` pilnuje, że każdy fragment
 * występuje w treści promptu dosłownie.
 */
export type CriterionRubric = {
  /** Co ocenia kryterium (po dwukropku w prompcie). */
  description: string;
  low: string;
  mid: string;
  high: string;
};

export const CRITERION_RUBRIC: Record<EvaluationCriterion, CriterionRubric> = {
  coherence: {
    description:
      "czy bloki pasują do siebie. Czy propozycja wartości odpowiada segmentom klientów, kanały docierają do tych segmentów, przychody wynikają z wartości, a zasoby, działania i partnerzy realnie umożliwiają jej dostarczenie.",
    low: "wyraźne sprzeczności lub luki między blokami",
    mid: "kluczowe powiązania są częściowo niejasne",
    high: "bloki wzajemnie się uzasadniają",
  },
  risk_resilience: {
    description:
      "jak bardzo model jest odporny na typowe ryzyka (zależność od jednego klienta, kanału lub partnera, nieznany popyt, silna konkurencja, koszty przewyższające przychody) i czy treść modelu te ryzyka adresuje.",
    low: "wysokie, niezaadresowane ryzyka",
    mid: "ryzyka istotne, częściowo zaadresowane",
    high: "ryzyko niskie lub dobrze zaadresowane",
  },
  feasibility: {
    description: "czy model da się uruchomić i utrzymać przy wskazanych zasobach, działaniach i kosztach.",
    low: "wymaga zasobów lub zdolności, których model nie przewiduje",
    mid: "wykonalny z istotnymi brakami",
    high: "wykonalny przy opisanych zasobach",
  },
  innovation: {
    description: "na ile propozycja wartości i sposób dostarczania wyróżniają się na tle typowych rozwiązań.",
    low: "powielenie istniejących rozwiązań",
    mid: "znane rozwiązanie z wyróżnikiem",
    high: "wyraźnie nowe podejście",
  },
};

export const RUBRIC_RISK_REMINDER = "10 oznacza ryzyko NISKIE.";
