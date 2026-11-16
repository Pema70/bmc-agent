"use client";

import { BLOCK_CARD_BASE, BLOCK_PLACEMENT, CANVAS_GRID } from "@/components/bmc/layout";
import { ImpactCanvasBanner } from "@/components/impact/canvas-banner";
import {
  ImpactBadge,
  ImpactDetails,
  impactBorderClass,
  useBlockImpact,
  type BlockImpactState,
} from "@/components/impact/block-impact";
import { BLOCK_INFO, BLOCK_KEYS, type BlockKey, type BmcState } from "@/lib/schemas/bmc";

// showImpact=false: podgląd cudzego stanu (np. kandydata strategii) bez wyróżnień aktywnej analizy wpływu bieżącego wariantu.
export function BmcCanvas({ state, showImpact = true }: { state: BmcState; showImpact?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      {showImpact ? <ImpactCanvasBanner /> : null}
      <div className={CANVAS_GRID}>
        {BLOCK_KEYS.map((key) => (
          <ReadOnlyBlock key={key} blockKey={key} entries={state[key]} showImpact={showImpact} />
        ))}
      </div>
    </div>
  );
}

function ReadOnlyBlock({ blockKey, entries, showImpact }: { blockKey: BlockKey; entries: string[]; showImpact: boolean }) {
  const blockImpact = useBlockImpact(blockKey);
  const impact: BlockImpactState = showImpact ? blockImpact : { kind: "none" };
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
