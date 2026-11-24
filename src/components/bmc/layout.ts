import type { BlockKey } from "@/lib/schemas/bmc";

// Klasyczny układ płótna na siatce 10 × 3, włączany od szerokości samego płótna (zapytanie o kontener: rodzic ma klasę
// `@container`), a nie okna, więc węższe płótno (np. otwarty panel) nie ściska kolumn; poniżej progu bloki idą jeden pod drugim.
export const CANVAS_CONTAINER = "@container";
export const CANVAS_GRID =
  "grid grid-cols-1 gap-3.5 @5xl:grid-cols-10 @5xl:grid-rows-[minmax(12rem,auto)_minmax(12rem,auto)_minmax(8.5rem,auto)]";

export const BLOCK_PLACEMENT: Record<BlockKey, string> = {
  key_partnerships: "@5xl:col-span-2 @5xl:row-span-2 @5xl:col-start-1 @5xl:row-start-1",
  key_activities: "@5xl:col-span-2 @5xl:col-start-3 @5xl:row-start-1",
  key_resources: "@5xl:col-span-2 @5xl:col-start-3 @5xl:row-start-2",
  value_propositions: "@5xl:col-span-2 @5xl:row-span-2 @5xl:col-start-5 @5xl:row-start-1",
  customer_relationships: "@5xl:col-span-2 @5xl:col-start-7 @5xl:row-start-1",
  channels: "@5xl:col-span-2 @5xl:col-start-7 @5xl:row-start-2",
  customer_segments: "@5xl:col-span-2 @5xl:row-span-2 @5xl:col-start-9 @5xl:row-start-1",
  cost_structure: "@5xl:col-span-5 @5xl:col-start-1 @5xl:row-start-3",
  revenue_streams: "@5xl:col-span-5 @5xl:col-start-6 @5xl:row-start-3",
};

// Obramowanie jest osobno (BLOCK_BORDER), bo wyróżnienie analizy wpływu zastępuje domyślną ramkę.
// Karta bloku: pełne, nieprzezroczyste tło (tekst wpisów zawsze na jednolitym tle), nagłówek jako gradient (`bg-head`).
export const BLOCK_CARD_BASE = "flex min-w-0 flex-col overflow-hidden rounded-2xl bg-surface text-text shadow-lg shadow-black/30";

// Nagłówek bloku i treść pod nim; długa lista wpisów przewija się wewnątrz bloku (od szerokiego układu), bez zmniejszania czcionki.
export const BLOCK_HEADER = "bg-head flex flex-col gap-0.5 px-4 py-2.5";
export const BLOCK_BODY = "flex flex-1 flex-col gap-2 p-4";
export const ENTRY_LIST_SCROLL = "@5xl:max-h-72 @5xl:overflow-y-auto @5xl:pr-1";
/** Od tylu wpisów blok pokazuje podpowiedź o przewijaniu. */
export const SCROLL_HINT_FROM = 7;
