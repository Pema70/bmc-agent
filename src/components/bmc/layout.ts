import type { BlockKey } from "@/lib/schemas/bmc";

// Klasyczny układ płótna na siatce 10 × 3; na wąskim ekranie bloki idą jeden pod drugim.
export const CANVAS_GRID =
  "grid grid-cols-1 gap-2 lg:grid-cols-10 lg:grid-rows-[minmax(11rem,auto)_minmax(11rem,auto)_minmax(8rem,auto)]";

export const BLOCK_PLACEMENT: Record<BlockKey, string> = {
  key_partnerships: "lg:col-span-2 lg:row-span-2 lg:col-start-1 lg:row-start-1",
  key_activities: "lg:col-span-2 lg:col-start-3 lg:row-start-1",
  key_resources: "lg:col-span-2 lg:col-start-3 lg:row-start-2",
  value_propositions: "lg:col-span-2 lg:row-span-2 lg:col-start-5 lg:row-start-1",
  customer_relationships: "lg:col-span-2 lg:col-start-7 lg:row-start-1",
  channels: "lg:col-span-2 lg:col-start-7 lg:row-start-2",
  customer_segments: "lg:col-span-2 lg:row-span-2 lg:col-start-9 lg:row-start-1",
  cost_structure: "lg:col-span-5 lg:col-start-1 lg:row-start-3",
  revenue_streams: "lg:col-span-5 lg:col-start-6 lg:row-start-3",
};

export const BLOCK_CARD =
  "flex flex-col gap-2 rounded-md border border-zinc-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900";
