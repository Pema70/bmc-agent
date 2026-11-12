"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { analyzeImpactAction } from "@/app/projekty/[id]/impact-actions";
import { useOptionalVariantWorkspace } from "@/components/bmc/variant-workspace";
import type { ImpactListItem } from "@/lib/db/impact";
import { impactHighlights, type ImpactHighlights } from "@/lib/impact/highlights";
import type { ImpactChangeRequest, ImpactView } from "@/lib/schemas/impact";

const GENERIC_ERROR = "Nie udało się wykonać analizy. Sprawdź połączenie i spróbuj ponownie.";

/** Gdzie pokazać błąd: pod przyciskiem konkretnej propozycji albo pod formularzem. */
export type ImpactScope = `proposal:${string}` | "form";

export type ImpactContextValue = {
  projectId: string;
  variantId: string;
  canAnalyze: boolean;
  // Wersja płótna: z edytora (EDITOR+), a dla VIEWER z serwera w chwili renderu.
  currentVersion: number;
  dirty: boolean;
  items: ImpactListItem[];
  selectedId: string | null;
  pendingScope: ImpactScope | null;
  error: { scope: ImpactScope; text: string } | null;
  select: (id: string) => void;
  // Analiza wyświetlana na płótnie. Wyliczana z listy, więc znika razem z rekordem (zmiana wariantu, odświeżenie)
  // i uszkodzony rekord nigdy nie trafia na płótno.
  activeId: string | null;
  active: ImpactView | null;
  highlights: ImpactHighlights | null;
  show: (id: string) => void;
  hide: () => void;
  analyze: (scope: ImpactScope, request: ImpactChangeRequest) => Promise<boolean>;
};

const ImpactContext = createContext<ImpactContextValue | null>(null);

export function useImpact(): ImpactContextValue {
  const value = useContext(ImpactContext);
  if (!value) {
    throw new Error("useImpact wymaga ImpactProvider.");
  }
  return value;
}

/** Jak useImpact, ale poza dostawcą zwraca null (np. karta propozycji bez analizy). */
export function useOptionalImpact(): ImpactContextValue | null {
  return useContext(ImpactContext);
}

type Props = {
  projectId: string;
  variantId: string;
  canAnalyze: boolean;
  currentVersion: number;
  initialItems: ImpactListItem[];
  children: ReactNode;
};

// Wyniki (opisy, podsumowania) są niezaufanym tekstem; komponenty wyświetlające renderują je jako węzły tekstowe.
export function ImpactProvider({ projectId, variantId, canAnalyze, currentVersion, initialItems, children }: Props) {
  const workspace = useOptionalVariantWorkspace();
  const dirty = workspace?.dirty ?? false;
  const version = workspace?.version ?? currentVersion;

  const [items, setItems] = useState<ImpactListItem[]>(initialItems);
  const [selectedId, setSelectedId] = useState<string | null>(() => firstValidId(initialItems));
  const [activeId, setActiveId] = useState<string | null>(null);
  // Po router.refresh() strona serwerowa przekazuje świeżą listę (np. analiza zlecona z czatu). Dołączamy tylko
  // brakujące rekordy, bez remountu dostawcy (obejmuje płótno i czat), i wybieramy najnowszą nową analizę.
  const [seenInitial, setSeenInitial] = useState(initialItems);
  if (seenInitial !== initialItems) {
    setSeenInitial(initialItems);
    const known = new Set(items.map(itemKey));
    const fresh = initialItems.filter((item) => !known.has(itemKey(item)));
    if (fresh.length > 0) {
      setItems([...fresh, ...items]);
      const newest = fresh.find((item) => item.ok);
      if (newest?.ok) {
        setSelectedId(newest.analysis.id);
      }
    }
  }
  const [pendingScope, setPendingScope] = useState<ImpactScope | null>(null);
  const [error, setError] = useState<ImpactContextValue["error"]>(null);

  // Ref chroni przed podwójnym uruchomieniem w tej samej chwili (stan React aktualizuje się asynchronicznie).
  const runningRef = useRef(false);

  const analyze = useCallback(
    async (scope: ImpactScope, request: ImpactChangeRequest): Promise<boolean> => {
      if (runningRef.current || dirty) {
        return false;
      }
      runningRef.current = true;
      setError(null);
      setPendingScope(scope);
      try {
        const result = await analyzeImpactAction(projectId, variantId, request);
        if (result.ok) {
          setItems((current) => [{ ok: true, analysis: result.analysis }, ...current]);
          setSelectedId(result.analysis.id);
          return true;
        }
        setError({ scope, text: result.message });
        return false;
      } catch (caught) {
        console.error("Analiza wpływu nie powiodła się", caught);
        setError({ scope, text: GENERIC_ERROR });
        return false;
      } finally {
        runningRef.current = false;
        setPendingScope(null);
      }
    },
    [projectId, variantId, dirty],
  );

  const active = useMemo(() => {
    const found = items.find((item) => item.ok && item.analysis.id === activeId);
    return found?.ok ? found.analysis : null;
  }, [items, activeId]);
  const highlights = useMemo(() => (active ? impactHighlights(active) : null), [active]);
  const show = useCallback((id: string) => setActiveId(id), []);
  const hide = useCallback(() => setActiveId(null), []);

  const value = useMemo<ImpactContextValue>(
    () => ({
      projectId,
      variantId,
      canAnalyze,
      currentVersion: version,
      dirty,
      items,
      selectedId,
      pendingScope,
      error,
      select: setSelectedId,
      activeId: active ? activeId : null,
      active,
      highlights,
      show,
      hide,
      analyze,
    }),
    [projectId, variantId, canAnalyze, version, dirty, items, selectedId, pendingScope, error, analyze, active, activeId, highlights, show, hide],
  );

  return <ImpactContext.Provider value={value}>{children}</ImpactContext.Provider>;
}

function itemKey(item: ImpactListItem): string {
  return item.ok ? item.analysis.id : item.id;
}

function firstValidId(items: ImpactListItem[]): string | null {
  for (const item of items) {
    if (item.ok) {
      return item.analysis.id;
    }
  }
  return null;
}
