"use client";

import { BLOCK_CARD_BASE, BLOCK_PLACEMENT, CANVAS_GRID } from "@/components/bmc/layout";
import { ImpactCanvasBanner } from "@/components/impact/canvas-banner";
import { ImpactBadge, ImpactDetails, impactBorderClass, useBlockImpact } from "@/components/impact/block-impact";
import { BLOCK_INFO, BLOCK_KEYS, type BlockKey, type BmcState } from "@/lib/schemas/bmc";

export function BmcCanvas({ state }: { state: BmcState }) {
  return (
    <div className="flex flex-col gap-2">
      <ImpactCanvasBanner />
      <div className={CANVAS_GRID}>
        {BLOCK_KEYS.map((key) => (
          <ReadOnlyBlock key={key} blockKey={key} entries={state[key]} />
        ))}
      </div>
    </div>
  );
}

function ReadOnlyBlock({ blockKey, entries }: { blockKey: BlockKey; entries: string[] }) {
  const impact = useBlockImpact(blockKey);
  return (
    <section
      aria-labelledby={`block-${blockKey}`}
      className={`${BLOCK_CARD_BASE} ${impactBorderClass(impact)} ${BLOCK_PLACEMENT[blockKey]}`}
    >
      <header className="flex flex-col gap-0.5">
        <h3 id={`block-${blockKey}`} className="text-sm font-semibold">
          {BLOCK_INFO[blockKey].label}
        </h3>
        <ImpactBadge state={impact} />
        <p className="text-xs text-zinc-500">{BLOCK_INFO[blockKey].description}</p>
      </header>
      <ImpactDetails state={impact} />
      {entries.length === 0 ? (
        <p className="text-sm text-zinc-400 italic">Brak wpisów.</p>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-4 text-sm break-words">
          {entries.map((entry, index) => (
            <li key={index}>{entry}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
