import { z } from "zod";

export const BMC_ENTRY_MAX_LENGTH = 500;
// D5: limit na blok i limit łączny (najwyżej ok. 75 tys. znaków stanu w kontekście agenta).
export const MAX_ENTRIES_PER_BLOCK = 30;
export const MAX_ENTRIES_TOTAL = 150;

export const BLOCK_KEYS = [
  "customer_segments",
  "value_propositions",
  "channels",
  "customer_relationships",
  "revenue_streams",
  "key_resources",
  "key_activities",
  "key_partnerships",
  "cost_structure",
] as const;

export const BlockKey = z.enum(BLOCK_KEYS);
export type BlockKey = z.infer<typeof BlockKey>;

export const BmcEntry = z
  .string({ error: "Wpis musi być tekstem." })
  .trim()
  .min(1, { error: "Wpis nie może być pusty." })
  .max(BMC_ENTRY_MAX_LENGTH, { error: `Wpis może mieć najwyżej ${BMC_ENTRY_MAX_LENGTH} znaków.` });
export type BmcEntry = z.infer<typeof BmcEntry>;

// W Zod 4 rekord z kluczem z.enum wymaga wszystkich 9 kluczy i odrzuca klucze spoza enuma.
export const BmcState = z
  .record(
    BlockKey,
    z.array(BmcEntry).max(MAX_ENTRIES_PER_BLOCK, {
      error: `Blok może mieć najwyżej ${MAX_ENTRIES_PER_BLOCK} wpisów.`,
    }),
  )
  .refine((state) => countEntries(state) <= MAX_ENTRIES_TOTAL, {
    error: `Model może mieć łącznie najwyżej ${MAX_ENTRIES_TOTAL} wpisów.`,
  });
export type BmcState = z.infer<typeof BmcState>;

export function countEntries(state: Record<BlockKey, readonly string[]>): number {
  return BLOCK_KEYS.reduce((total, key) => total + state[key].length, 0);
}

export function emptyBmcState(): BmcState {
  return {
    customer_segments: [],
    value_propositions: [],
    channels: [],
    customer_relationships: [],
    revenue_streams: [],
    key_resources: [],
    key_activities: [],
    key_partnerships: [],
    cost_structure: [],
  };
}

export const BLOCK_INFO: Record<BlockKey, { label: string; description: string }> = {
  customer_segments: {
    label: "Segmenty klientów",
    description: "Dla kogo tworzymy wartość? Kim są najważniejsi klienci?",
  },
  value_propositions: {
    label: "Propozycja wartości",
    description: "Jaki problem klienta rozwiązujemy i jaką potrzebę zaspokajamy?",
  },
  channels: {
    label: "Kanały",
    description: "Jak docieramy do klientów i dostarczamy im propozycję wartości?",
  },
  customer_relationships: {
    label: "Relacje z klientami",
    description: "Jakie relacje budujemy i utrzymujemy z każdym segmentem?",
  },
  revenue_streams: {
    label: "Strumienie przychodów",
    description: "Za co i w jaki sposób klienci są gotowi płacić?",
  },
  key_resources: {
    label: "Kluczowe zasoby",
    description: "Jakie zasoby są niezbędne, by dostarczać propozycję wartości?",
  },
  key_activities: {
    label: "Kluczowe działania",
    description: "Co musimy robić, aby model biznesowy działał?",
  },
  key_partnerships: {
    label: "Kluczowi partnerzy",
    description: "Kim są partnerzy i dostawcy, bez których się nie obejdziemy?",
  },
  cost_structure: {
    label: "Struktura kosztów",
    description: "Jakie są najważniejsze koszty prowadzenia działalności?",
  },
};
