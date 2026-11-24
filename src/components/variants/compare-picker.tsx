"use client";

import Link from "next/link";
import { useState } from "react";
import { useOptionalVariantWorkspace } from "@/components/bmc/variant-workspace";
import { compareHref, orderSelection, selectionState } from "@/lib/comparison/presentation";
import { sortVariants, switchBlockReason, variantBadges, type VariantSummary } from "@/lib/variants/presentation";

type ComparePickerProps = {
  projectId: string;
  variants: VariantSummary[];
};

const badgeClass =
  "rounded border border-border px-1.5 py-0.5 text-xs font-semibold text-muted";
const actionClass =
  "w-fit rounded-lg border border-border px-3 py-1.5 text-sm font-bold hover:bg-tint";

/**
 * Wybór 2-3 wariantów do porównania i przejście na /projekty/[id]/porownanie. Nawigacja jest zwykłym linkiem, więc przy
 * niezapisanych zmianach płótna (dirty z VariantWorkspaceProvider) jest zablokowana tą samą regułą i komunikatem co
 * przełączanie wariantów. VIEWER nie ma edytora, więc dla niego blokady nie ma. Nazwy to węzły tekstowe React.
 */
export function ComparePicker({ projectId, variants }: ComparePickerProps) {
  const workspace = useOptionalVariantWorkspace();
  const blockReason = switchBlockReason(workspace?.dirty ?? false);
  const [selected, setSelected] = useState<string[]>([]);

  const ordered = sortVariants(variants);
  const orderedIds = orderSelection(ordered, selected);
  const state = selectionState(orderedIds.length);

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="text-sm font-semibold">Porównanie wariantów</legend>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {ordered.map((variant) => {
          const badges = variantBadges(variant);
          return (
            <li key={variant.id} className="min-w-0">
              <label className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
                <input type="checkbox" checked={orderedIds.includes(variant.id)} onChange={() => toggle(variant.id)} />
                <span className="min-w-0 break-words">{variant.name}</span>
                {badges.map((badge) => (
                  <span key={badge} className={badgeClass}>
                    {badge}
                  </span>
                ))}
              </label>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">{state.hint}</p>
      {blockReason && state.canCompare ? (
        <p role="status" className="text-sm text-medium-fg">
          {blockReason}
        </p>
      ) : null}
      {state.canCompare && !blockReason ? (
        <Link href={compareHref(projectId, orderedIds)} className={actionClass}>
          Porównaj
        </Link>
      ) : (
        <button type="button" disabled aria-disabled="true" className={`${actionClass} opacity-50`}>
          Porównaj
        </button>
      )}
    </fieldset>
  );
}
