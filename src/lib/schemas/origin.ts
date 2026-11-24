import { z } from "zod";
import { BlockKey, MAX_ENTRIES_TOTAL } from "@/lib/schemas/bmc";
import { ProposalSourceKind } from "@/lib/schemas/proposal";

/**
 * Pochodzenie wpisu BMC (krok 9). Zapisywane w BmcVariant.entryOrigins (Json) tym samym UPDATE, który zapisuje stan.
 * Klucz tożsamości wpisu to (blockKey, tekst): wpisy są zwykłymi stringami bez identyfikatorów, więc duplikaty w bloku
 * dzielą jedno pochodzenie, a ręcznie zmieniony tekst to nowy wpis.
 *
 * MANUAL oznacza wyłącznie, że bieżący tekst wpisu zapisał użytkownik z edytora (także gdy poprawił wcześniejszą propozycję AI:
 * edycji nie śledzimy). PROPOSAL to zaakceptowana propozycja agenta (sourceKind mówi, skąd agent ją wziął), STRATEGY to wpis z
 * kandydata strategii AI zapisanego jako wariant.
 */
export const ENTRY_ORIGIN_KINDS = ["MANUAL", "PROPOSAL", "STRATEGY"] as const;
export const EntryOriginKind = z.enum(ENTRY_ORIGIN_KINDS);
export type EntryOriginKind = z.infer<typeof EntryOriginKind>;

export const EntryOrigin = z.strictObject({
  blockKey: BlockKey,
  text: z.string().min(1),
  kind: EntryOriginKind,
  // PROPOSAL: id propozycji (może później zniknąć z bazy; to tylko ślad), źródło propozycji i migawki z chwili akceptacji.
  proposalId: z.string().min(1).optional(),
  sourceKind: ProposalSourceKind.optional(),
  attachmentName: z.string().min(1).optional(),
  roundNumber: z.number().int().min(1).optional(),
  questionIndex: z.number().int().min(0).optional(),
  // STRATEGY: nazwa strategii z chwili zapisu wariantu.
  strategyName: z.string().min(1).optional(),
  // Wersja stanu wariantu, w której zapisano to pochodzenie.
  recordedVersion: z.number().int().min(1),
});
export type EntryOrigin = z.infer<typeof EntryOrigin>;

export const EntryOrigins = z.array(EntryOrigin).max(MAX_ENTRIES_TOTAL);

/**
 * Odczyt zapisanego pochodzenia z kolumny Json. Uszkodzony zapis nie wywraca zapisu stanu ani raportu: zwracamy pustą
 * listę i flagę `corrupt` (raport pokaże to jawnie, a następny zapis stanu zastąpi kolumnę poprawną).
 */
export function parseStoredOrigins(raw: unknown): { origins: EntryOrigin[]; corrupt: boolean } {
  const parsed = EntryOrigins.safeParse(raw ?? []);
  return parsed.success ? { origins: parsed.data, corrupt: false } : { origins: [], corrupt: true };
}
