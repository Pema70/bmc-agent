import { exportText } from "@/lib/export/sanitize";
import type { OriginCertainty, OriginInfo } from "@/lib/report/provenance";

/**
 * Etykiety źródeł wpisów w raporcie (plan kroku 9, „Zmiany po akceptacji” pkt 1). Zasada: „ręczny” to jedyny rodzaj, który
 * oznacza tekst użytkownika; pozostałe rodzaje to propozycje AI. Nazwa załącznika jest niezaufanym tekstem: przechodzi przez
 * `exportText` i trafia do dokumentu tylko jako zwykły tekst. Numer pytania w zapisie liczony jest od 0, w raporcie od 1.
 */

export const INFERRED_SUFFIX = " (ustalone po tekście, prawdopodobne)";

export const SOURCE_LEGEND_NOTE =
  "Wartość „propozycja agenta w rozmowie” nie oznacza, że treść podał użytkownik: agent nie zawsze deklaruje wiedzę własną " +
  "(„wiedza modelu”), więc część takich propozycji może opierać się na ogólnej wiedzy modelu.";

export const MANUAL_EDIT_NOTE =
  "Wpis oznaczony „ręczny” może zawierać tekst zaproponowany wcześniej przez agenta i poprawiony ręcznie; raport nie śledzi " +
  "edycji, zapisuje tylko, że bieżący tekst wpisał użytkownik.";

export type SourceCode = "R" | "Rz" | "Z" | "P" | "W" | "S" | "?";

export const SOURCE_CODE_LEGEND: ReadonlyArray<{ code: SourceCode; meaning: string }> = [
  { code: "R", meaning: "ręczny (tekst użytkownika)" },
  { code: "Rz", meaning: "propozycja agenta w rozmowie (zaakceptowana)" },
  { code: "Z", meaning: "propozycja agenta na podstawie załącznika" },
  { code: "P", meaning: "propozycja z cyklu poprawek (na podstawie odpowiedzi użytkownika)" },
  { code: "W", meaning: "wiedza modelu (deklaracja agenta, niezweryfikowana)" },
  { code: "S", meaning: "strategia AI" },
  { code: "?", meaning: "źródło nieznane" },
];

export function sourceCode(origin: OriginInfo | null): SourceCode {
  if (!origin) {
    return "?";
  }
  if (origin.kind === "MANUAL") {
    return "R";
  }
  if (origin.kind === "STRATEGY") {
    return "S";
  }
  switch (origin.sourceKind) {
    case "ATTACHMENT":
      return "Z";
    case "REFINEMENT":
      return "P";
    case "MODEL_KNOWLEDGE":
      return "W";
    default:
      return "Rz";
  }
}

function baseLabel(origin: OriginInfo | null): string {
  if (!origin) {
    return "źródło nieznane";
  }
  if (origin.kind === "MANUAL") {
    return "ręczny (tekst użytkownika)";
  }
  if (origin.kind === "STRATEGY") {
    const name = exportText(origin.strategyName);
    return name ? `strategia AI ${name}` : "strategia AI";
  }
  switch (origin.sourceKind) {
    case "ATTACHMENT": {
      const name = exportText(origin.attachmentName);
      return name ? `propozycja agenta na podstawie załącznika ${name}` : "propozycja agenta na podstawie załącznika (nazwa niedostępna)";
    }
    case "REFINEMENT": {
      const position =
        origin.roundNumber !== undefined && origin.questionIndex !== undefined
          ? `, runda ${origin.roundNumber}, pytanie ${origin.questionIndex + 1}`
          : origin.roundNumber !== undefined
            ? `, runda ${origin.roundNumber}`
            : "";
      return `propozycja z cyklu poprawek${position} (na podstawie odpowiedzi użytkownika)`;
    }
    case "MODEL_KNOWLEDGE":
      return "wiedza modelu (deklaracja agenta, niezweryfikowana)";
    default:
      return "propozycja agenta w rozmowie (zaakceptowana)";
  }
}

/** Pełna etykieta źródła wpisu; przy pewności „ustalone po tekście” z dopiskiem, przy braku zapisu „źródło nieznane”. */
export function sourceLabel(origin: OriginInfo | null, certainty: OriginCertainty): string {
  if (!origin || certainty === "NIEZNANE") {
    return "źródło nieznane";
  }
  return certainty === "USTALONE_PO_TEKSCIE" ? `${baseLabel(origin)}${INFERRED_SUFFIX}` : baseLabel(origin);
}

export const CERTAINTY_LABELS: Record<OriginCertainty, string> = {
  ZAPISANE: "zapisane",
  USTALONE_PO_TEKSCIE: "ustalone po tekście (prawdopodobne)",
  NIEZNANE: "nieznane",
};
