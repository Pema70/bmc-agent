import { BLOCK_INFO, BLOCK_KEYS } from "@/lib/schemas/bmc";
import { PROPOSAL_OPERATION_LABELS } from "@/lib/schemas/proposal";
import { IMPACT_LEVELS, type AffectedBlock, type ImpactChange, type ImpactLevel } from "@/lib/schemas/impact";

const LEVEL_RANK: Record<ImpactLevel, number> = Object.fromEntries(
  IMPACT_LEVELS.map((level, index) => [level, index]),
) as Record<ImpactLevel, number>;

/** Dotknięte bloki do wyświetlenia: stopień malejąco, potem kanoniczna kolejność bloków. Nie zmienia wejścia. */
export function sortAffected(affected: readonly AffectedBlock[]): AffectedBlock[] {
  return [...affected].sort(
    (a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || BLOCK_KEYS.indexOf(a.blockKey) - BLOCK_KEYS.indexOf(b.blockKey),
  );
}

/** Opis zmiany jako zwykły tekst (wpisy i opisy pochodzą od użytkownika lub modelu, więc nigdy jako HTML). */
export function describeChange(change: ImpactChange): string {
  const block = BLOCK_INFO[change.blockKey].label;
  if (change.kind === "DESCRIPTION") {
    return `Blok ${block}: ${change.description}`;
  }
  const operation = PROPOSAL_OPERATION_LABELS[change.operation];
  const parts = [change.before !== null ? `„${change.before}”` : null, change.after !== null ? `„${change.after}”` : null];
  return `Blok ${block}: ${operation} ${parts.filter((part) => part !== null).join(" → ")}`;
}

/** Analiza dotyczy starszej wersji płótna niż aktualna. */
export function isImpactStale(analysisVariantVersion: number, currentVersion: number): boolean {
  return analysisVariantVersion < currentVersion;
}
