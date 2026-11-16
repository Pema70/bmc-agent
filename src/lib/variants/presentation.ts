import type { VariantListItem } from "@/lib/db/variants";
import { VARIANT_ORIGIN_LABELS, type VariantOrigin } from "@/lib/schemas/variant";

export const SWITCH_BLOCKED_MESSAGE = "Najpierw zapisz albo cofnij swoje zmiany";
export const MAIN_BADGE = "Główny";

/** Widok wariantu przekazywany do komponentów klienckich: same typy proste, data jako tekst z serwera. */
export type VariantSummary = {
  id: string;
  name: string;
  isMain: boolean;
  origin: VariantOrigin;
  description: string | null;
  version: number;
  createdAt: string;
  updatedLabel: string;
  entryCount: number | null;
};

// Strefa stała, żeby wynik nie zależał od ustawień serwera i był taki sam w testach.
const dateFormat = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw" });

export function formatVariantDate(date: Date): string {
  return dateFormat.format(date);
}

export function toVariantSummary(item: VariantListItem): VariantSummary {
  return {
    id: item.id,
    name: item.name,
    isMain: item.isMain,
    origin: item.origin,
    description: item.description,
    version: item.version,
    createdAt: item.createdAt.toISOString(),
    updatedLabel: formatVariantDate(item.updatedAt),
    entryCount: item.entryCount,
  };
}

/** Wariant główny pierwszy, potem od najnowszego (data utworzenia, przy remisie id malejąco). Nie zmienia wejścia. */
export function sortVariants<T extends Pick<VariantSummary, "id" | "isMain" | "createdAt">>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.isMain !== b.isMain) {
      return a.isMain ? -1 : 1;
    }
    if (a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? 1 : -1;
    }
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/** Plakietki tekstowe (nie tylko kolor): „Główny” i/lub „Strategia AI”. Wariant własny bez plakietki pochodzenia. */
export function variantBadges(variant: Pick<VariantSummary, "isMain" | "origin">): string[] {
  const badges: string[] = [];
  if (variant.isMain) {
    badges.push(MAIN_BADGE);
  }
  if (variant.origin === "AI_STRATEGY") {
    badges.push(VARIANT_ORIGIN_LABELS.AI_STRATEGY);
  }
  return badges;
}

/** Powód blokady przełączenia wariantu albo null. Zmiana wariantu przemontowuje płótno, więc niezapisane zmiany by zginęły. */
export function switchBlockReason(dirty: boolean): string | null {
  return dirty ? SWITCH_BLOCKED_MESSAGE : null;
}

/** Adres wariantu: główny ma adres bez parametru, pozostałe ?wariant=<id>. */
export function variantHref(projectId: string, variant: Pick<VariantSummary, "id" | "isMain">): string {
  const base = `/projekty/${projectId}`;
  return variant.isMain ? base : `${base}?wariant=${encodeURIComponent(variant.id)}`;
}

/** „1 oczekującą propozycję”, „2 oczekujące propozycje”, „5 oczekujących propozycji” (dopełniacz/biernik po polsku). */
export function pendingProposalsPhrase(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (count === 1) {
    return "1 oczekującą propozycję";
  }
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) {
    return `${count} oczekujące propozycje`;
  }
  return `${count} oczekujących propozycji`;
}

/**
 * Treść potwierdzenia ustawienia wariantu głównego. Propozycje oczekujące na starym głównym zostają na nim:
 * można je rozpatrzyć po otwarciu tamtego wariantu, a w czacie nowego głównego ich karty pokażą „Status nieznany”.
 */
export function setMainConfirmMessage(args: { name: string; pendingOnOldMain: number }): string {
  const lines = [
    `Ustawić „${args.name}” jako wariant główny?`,
    "Czat z agentem będzie działał na tym wariancie.",
  ];
  if (args.pendingOnOldMain > 0) {
    lines.push(
      `Dotychczasowy wariant główny ma ${pendingProposalsPhrase(args.pendingOnOldMain)} od agenta. Zostaną na nim: ` +
        "rozpatrzysz je po otwarciu tamtego wariantu, a w czacie ich karty pokażą „Status nieznany”.",
    );
  }
  return lines.join("\n\n");
}
