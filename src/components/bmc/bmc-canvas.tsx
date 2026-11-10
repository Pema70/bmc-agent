import { BLOCK_INFO, BLOCK_KEYS, type BlockKey, type BmcState } from "@/lib/schemas/bmc";

// Klasyczny układ płótna na siatce 10 × 3; na wąskim ekranie bloki idą jeden pod drugim.
const BLOCK_PLACEMENT: Record<BlockKey, string> = {
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

export function BmcCanvas({ state }: { state: BmcState }) {
  return (
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-10 lg:grid-rows-[minmax(11rem,auto)_minmax(11rem,auto)_minmax(8rem,auto)]">
      {BLOCK_KEYS.map((key) => (
        <section
          key={key}
          aria-labelledby={`block-${key}`}
          className={`flex flex-col gap-2 rounded-md border border-zinc-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900 ${BLOCK_PLACEMENT[key]}`}
        >
          <header className="flex flex-col gap-0.5">
            <h3 id={`block-${key}`} className="text-sm font-semibold">
              {BLOCK_INFO[key].label}
            </h3>
            <p className="text-xs text-zinc-500">{BLOCK_INFO[key].description}</p>
          </header>
          {state[key].length === 0 ? (
            <p className="text-sm text-zinc-400 italic">Brak wpisów.</p>
          ) : (
            <ul className="flex list-disc flex-col gap-1 pl-4 text-sm break-words">
              {state[key].map((entry, index) => (
                <li key={index}>{entry}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
