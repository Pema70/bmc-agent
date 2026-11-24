"use client";

import {
  BLOCK_BODY,
  BLOCK_CARD_BASE,
  BLOCK_HEADER,
  BLOCK_PLACEMENT,
  CANVAS_CONTAINER,
  CANVAS_GRID,
  ENTRY_LIST_SCROLL,
  SCROLL_HINT_FROM,
} from "@/components/bmc/layout";
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
    <div className={`${CANVAS_CONTAINER} flex flex-col gap-2`}>
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
      <header className={BLOCK_HEADER}>
        <h3 id={`block-${blockKey}`} className="text-sm font-bold">
          {BLOCK_INFO[blockKey].label}
        </h3>
        <ImpactBadge state={impact} />
        <p className="text-xs text-muted">{BLOCK_INFO[blockKey].description}</p>
      </header>
      <div className={BLOCK_BODY}>
      <ImpactDetails state={impact} />
      {entries.length === 0 ? (
        <p className="text-sm text-muted italic">Brak wpisów.</p>
      ) : (
        <>
        {entries.length >= SCROLL_HINT_FROM ? <p className="text-xs text-muted">Przewiń: wpisów w bloku {entries.length}</p> : null}
        <ul
          tabIndex={entries.length >= SCROLL_HINT_FROM ? 0 : undefined}
          aria-label={entries.length >= SCROLL_HINT_FROM ? `Wpisy: ${BLOCK_INFO[blockKey].label}` : undefined}
          className={`flex list-disc flex-col gap-1.5 pl-5 text-[0.9375rem] leading-normal break-words ${ENTRY_LIST_SCROLL}`}
        >
          {entries.map((entry, index) => (
            <li key={index}>{entry}</li>
          ))}
        </ul>
        </>
      )}
      </div>
    </section>
  );
}
