"use client";

import { useRef, useState } from "react";
import { compareVariantsAction } from "@/app/projekty/[id]/comparison-actions";
import { AiBadge, AiNotice } from "@/components/ai/ai-notice";
import { ComparisonResult } from "@/components/comparison/comparison-result";
import type { ComparisonListItem } from "@/lib/db/comparisons";
import {
  COMPARE_AI_LABEL,
  COMPARE_NOTICE,
  comparisonItemId,
  describeComparison,
  firstValidComparisonId,
  mergeComparisonItems,
  summarizeComparison,
} from "@/lib/comparison/presentation";

type Props = {
  projectId: string;
  // Identyfikatory porównywanych wariantów w kolejności z adresu (pierwszy to wariant odniesienia).
  variantIds: string[];
  // Aktualne wersje porównywanych wariantów z serwera w chwili renderu (do znacznika „aktualna to M”).
  current: { id: string; version: number }[];
  canCompare: boolean;
  // Historia porównań tego zestawu wariantów (bez stanów).
  initialItems: ComparisonListItem[];
};

const GENERIC_ERROR = "Nie udało się wykonać porównania. Sprawdź połączenie i spróbuj ponownie.";

/**
 * Sekcja „Analiza AI” strony porównania: przycisk „Porównaj z AI” (EDITOR+), wynik i historia. Porównanie działa na
 * zapisanych stanach wariantów (niezapisane zmiany płótna są poza tą stroną, a wejście tu z projektu jest zablokowane
 * przy takich zmianach). Nowe pozycje po odświeżeniu danych serwera dołączane są z propsów bez remountu, więc komponent
 * nie wymaga `key` zależnego od listy. Treści z modelu i od użytkownika to węzły tekstowe React.
 */
export function ComparisonPanel({ projectId, variantIds, current, canCompare, initialItems }: Props) {
  const [items, setItems] = useState<ComparisonListItem[]>(initialItems);
  const [selectedId, setSelectedId] = useState<string | null>(() => firstValidComparisonId(initialItems));
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Chroni przed podwójnym kliknięciem w tej samej chwili (stan React aktualizuje się asynchronicznie).
  const runningRef = useRef(false);

  const [seenInitial, setSeenInitial] = useState(initialItems);
  if (seenInitial !== initialItems) {
    setSeenInitial(initialItems);
    const known = new Set(items.map(comparisonItemId));
    const newest = initialItems.find((item) => item.ok && !known.has(item.comparison.id));
    setItems(mergeComparisonItems(items, initialItems));
    if (newest?.ok) {
      setSelectedId(newest.comparison.id);
    }
  }

  const selected = items.find((item) => item.ok && item.comparison.id === selectedId);
  const comparison = selected?.ok ? selected.comparison : null;

  async function compare() {
    if (runningRef.current || !canCompare) {
      return;
    }
    runningRef.current = true;
    setComparing(true);
    setError(null);
    try {
      const result = await compareVariantsAction(projectId, variantIds);
      if (result.ok) {
        const summary = summarizeComparison(result.comparison);
        setItems((currentItems) => mergeComparisonItems(currentItems, [{ ok: true, comparison: summary }]));
        setSelectedId(summary.id);
      } else {
        setError(result.message);
      }
    } catch (caught) {
      console.error("Porównanie wariantów nie powiodło się", caught);
      setError(GENERIC_ERROR);
    } finally {
      runningRef.current = false;
      setComparing(false);
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="compare-ai-heading">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="compare-ai-heading" className="text-lg font-semibold">
          Porównanie wariantów
        </h2>
        <AiBadge label={COMPARE_AI_LABEL} />
      </div>

      <AiNotice>{COMPARE_NOTICE}</AiNotice>

      {canCompare ? (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={() => void compare()}
            disabled={comparing}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {comparing ? "Porównuję…" : "Porównaj z AI"}
          </button>
          {error ? (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Uruchamianie porównania z AI jest dostępne dla edytorów i właścicieli projektu.
        </p>
      )}

      {comparison ? (
        <ComparisonResult comparison={comparison} current={current} />
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {items.length === 0 ? "Ten zestaw wariantów nie ma jeszcze porównania z AI." : "Wybierz porównanie z historii."}
        </p>
      )}

      {items.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Historia porównań tego zestawu</h3>
          <ul className="flex flex-col gap-1">
            {items.map((item) =>
              item.ok ? (
                <li key={item.comparison.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.comparison.id)}
                    aria-pressed={item.comparison.id === selectedId}
                    className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-left text-sm break-words hover:bg-zinc-100 aria-pressed:border-zinc-900 aria-pressed:font-medium dark:border-zinc-700 dark:hover:bg-zinc-800 dark:aria-pressed:border-zinc-300"
                  >
                    {describeComparison(item.comparison)}
                  </button>
                </li>
              ) : (
                <li
                  key={item.id}
                  className="rounded-md border border-red-600 px-3 py-1.5 text-sm break-words text-red-700 dark:text-red-400"
                >
                  Nie można wyświetlić zapisanego porównania ({item.id}): {item.error}
                </li>
              ),
            )}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
