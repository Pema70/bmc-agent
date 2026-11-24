"use client";

import Link from "next/link";
import { useOptionalVariantWorkspace } from "@/components/bmc/variant-workspace";
import {
  sortVariants,
  switchBlockReason,
  variantBadges,
  variantHref,
  type VariantSummary,
} from "@/lib/variants/presentation";

type VariantSwitcherProps = {
  projectId: string;
  variants: VariantSummary[];
  currentId: string;
};

const cardBase = "flex h-full flex-col gap-1 rounded-md border-2 p-3 text-sm";
const badgeClass =
  "rounded border border-border px-1.5 py-0.5 text-xs font-semibold text-muted";

/**
 * Lista wariantów projektu. Zmiana wariantu przemontowuje płótno, więc przy niezapisanych zmianach (dirty z
 * VariantWorkspaceProvider) przełączenie jest zablokowane. VIEWER nie ma edytora, więc dostaje zwykłe linki.
 * Wszystkie teksty (także nazwy wariantów, które pisze użytkownik i model) to węzły tekstowe React.
 */
export function VariantSwitcher({ projectId, variants, currentId }: VariantSwitcherProps) {
  const workspace = useOptionalVariantWorkspace();
  const blockReason = switchBlockReason(workspace?.dirty ?? false);

  return (
    <nav aria-label="Warianty modelu" className="flex flex-col gap-2">
      {blockReason ? (
        <p role="status" className="text-sm text-medium-fg">
          {blockReason}
        </p>
      ) : null}
      <ul className="flex flex-wrap gap-2">
        {sortVariants(variants).map((variant) => {
          const current = variant.id === currentId;
          const badges = variantBadges(variant);
          const content = (
            <>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="min-w-0 break-words font-medium">{variant.name}</span>
                {badges.map((badge) => (
                  <span key={badge} className={badgeClass}>
                    {badge}
                  </span>
                ))}
                {current ? <span className={badgeClass}>Otwarty</span> : null}
              </span>
              <span className="text-xs text-muted">
                Wersja {variant.version} · zmieniono {variant.updatedLabel}
                {variant.entryCount !== null ? ` · wpisów: ${variant.entryCount}` : ""}
              </span>
            </>
          );

          return (
            <li key={variant.id} className="min-w-0 basis-56 flex-1">
              {current ? (
                <div
                  aria-current="true"
                  className={`${cardBase} border-ring bg-tint`}
                >
                  {content}
                </div>
              ) : blockReason ? (
                <div
                  aria-disabled="true"
                  className={`${cardBase} border-dashed border-border opacity-60`}
                >
                  {content}
                </div>
              ) : (
                <Link
                  href={variantHref(projectId, variant)}
                  className={`${cardBase} border-border hover:bg-tint`}
                >
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
