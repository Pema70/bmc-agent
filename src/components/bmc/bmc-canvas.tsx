import { BLOCK_CARD, BLOCK_PLACEMENT, CANVAS_GRID } from "@/components/bmc/layout";
import { BLOCK_INFO, BLOCK_KEYS, type BmcState } from "@/lib/schemas/bmc";

export function BmcCanvas({ state }: { state: BmcState }) {
  return (
    <div className={CANVAS_GRID}>
      {BLOCK_KEYS.map((key) => (
        <section key={key} aria-labelledby={`block-${key}`} className={`${BLOCK_CARD} ${BLOCK_PLACEMENT[key]}`}>
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
