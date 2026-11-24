/**
 * Czysta logika paska narzędzi i paneli strony projektu (plan `docs/plan-design.md`): identyfikatory paneli, dozwolone panele
 * dla roli, odczyt parametrów adresu (`?panel=`, `?czat=`), plakietki przycisków i nawigacja strzałkami. Bez Reacta i bez
 * dostępu do przeglądarki, więc testowalna w środowisku `node`.
 */

export const PANEL_IDS = ["ocena", "wplyw", "warianty", "porownanie", "poprawki", "zalaczniki", "eksport"] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export type ToolbarItemId = "czat" | PanelId;
export const TOOLBAR_ORDER: readonly ToolbarItemId[] = ["czat", ...PANEL_IDS];

/** Teksty przycisków paska. */
export const TOOLBAR_LABELS: Record<ToolbarItemId, string> = {
  czat: "Czat",
  ocena: "Ocena",
  wplyw: "Wpływ",
  warianty: "Warianty i strategie",
  porownanie: "Porównanie",
  poprawki: "Cykl poprawek",
  zalaczniki: "Załączniki",
  eksport: "Eksport i raport",
};

/** Nagłówki paneli (pełniejsze niż etykiety przycisków). */
export const PANEL_TITLES: Record<PanelId, string> = {
  ocena: "Ocena modelu",
  wplyw: "Analiza wpływu zmian",
  warianty: "Warianty i strategie",
  porownanie: "Porównanie wariantów",
  poprawki: "Cykl poprawek",
  zalaczniki: "Załączniki",
  eksport: "Eksport i raport",
};

/** Panele dostępne dla danego widoku: większość wymaga wariantu, cykl poprawek roli EDITOR i wyżej, załączniki zawsze. */
export function availablePanels(input: { hasVariant: boolean; canEditCanvas: boolean }): PanelId[] {
  return PANEL_IDS.filter((id) => {
    if (id === "zalaczniki") {
      return true;
    }
    if (!input.hasVariant) {
      return false;
    }
    return id === "poprawki" ? input.canEditCanvas : true;
  });
}

/** `?panel=`: wartość z allowlisty i dozwolona dla widoku; wszystko inne (powtórzony parametr, obca wartość) to brak panelu. */
export function parsePanelParam(value: string | string[] | undefined, available: readonly PanelId[]): PanelId | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = PANEL_IDS.find((id) => id === value);
  return match && available.includes(match) ? match : null;
}

/** `?czat=`: „1” rozwinięty, „0” zwinięty, brak lub obca wartość to null (decyduje domyślne ustawienie wg szerokości). */
export function parseChatParam(value: string | string[] | undefined): boolean | null {
  if (value === "1") {
    return true;
  }
  if (value === "0") {
    return false;
  }
  return null;
}

/** Nowy ciąg zapytania adresu z zachowaniem innych parametrów (np. `wariant`). Zwraca „” albo ciąg zaczynający się od „?”. */
export function withUiParams(search: string, update: { panel?: PanelId | null; chat?: boolean | null }): string {
  const params = new URLSearchParams(search);
  if ("panel" in update) {
    if (update.panel) {
      params.set("panel", update.panel);
    } else {
      params.delete("panel");
    }
  }
  if ("chat" in update) {
    if (update.chat === null || update.chat === undefined) {
      params.delete("czat");
    } else {
      params.set("czat", update.chat ? "1" : "0");
    }
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Odmiana „propozycja” dla opisu plakietki (1 propozycja oczekuje, 2 do 4 oczekują, 5 i więcej oczekuje). */
export function pendingProposalsText(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (count === 1) {
    return "1 propozycja oczekuje na decyzję";
  }
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) {
    return `${count} propozycje oczekują na decyzję`;
  }
  return `${count} propozycji oczekuje na decyzję`;
}

export type ToolbarBadge = {
  /** Krótki, widoczny tekst plakietki. */
  text: string;
  /** Pełny opis dla czytników ekranu (widoczny tekst jest dla nich ukryty). */
  description: string;
};

export type ToolbarBadgeInput = {
  pendingProposals: number;
  currentVersion: number;
  evaluation: { hasAny: boolean; latestVersion: number | null };
  impactActive: boolean;
  variantCount: number;
  refinement: { rounds: number; awaitingAnswers: boolean; max: number };
  attachments: { count: number; max: number };
  dirty: boolean;
};

/** Plakietki przycisków paska; brak plakietki to null. Źródła danych opisane w planie (tabela „Plakietki na przyciskach”). */
export function toolbarBadges(input: ToolbarBadgeInput): Record<ToolbarItemId, ToolbarBadge | null> {
  const { evaluation, refinement, attachments } = input;
  const evaluationBadge: ToolbarBadge | null = !evaluation.hasAny
    ? { text: "brak", description: "brak oceny tego wariantu" }
    : evaluation.latestVersion !== null && evaluation.latestVersion < input.currentVersion
      ? {
          text: "nieaktualna",
          description: `ocena nieaktualna: dotyczy wersji ${evaluation.latestVersion}, bieżąca wersja to ${input.currentVersion}`,
        }
      : null;

  return {
    czat: input.pendingProposals > 0 ? { text: String(input.pendingProposals), description: pendingProposalsText(input.pendingProposals) } : null,
    ocena: evaluationBadge,
    wplyw: input.impactActive ? { text: "aktywna", description: "aktywna analiza wpływu, wyróżniona na płótnie" } : null,
    warianty: input.variantCount > 0 ? { text: String(input.variantCount), description: `liczba wariantów: ${input.variantCount}` } : null,
    porownanie: null,
    poprawki:
      refinement.rounds > 0
        ? {
            text: `${refinement.rounds}/${refinement.max}`,
            description: `runda ${refinement.rounds} z ${refinement.max}${refinement.awaitingAnswers ? ", czeka na odpowiedzi" : ""}`,
          }
        : null,
    zalaczniki: { text: `${attachments.count}/${attachments.max}`, description: `${attachments.count} z ${attachments.max} załączników` },
    eksport: input.dirty ? { text: "niezapisane", description: "niezapisane zmiany nie są uwzględnione w eksporcie" } : null,
  };
}

/** Roving tabindex: indeks następnego przycisku po klawiszu albo null, gdy klawisz nie służy do nawigacji po pasku. */
export function nextToolbarIndex(current: number, key: string, length: number): number | null {
  if (length <= 0) {
    return null;
  }
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % length;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + length) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return null;
  }
}
