import type { ReactNode } from "react";
import { formatEvaluationDate } from "@/lib/evaluation/format";

/**
 * Wspólne oznaczenia wyników AI dla nowych funkcji kroku 6 (strategie, porównanie wariantów). Stałe i nieukrywalne,
 * tekstem, a nie samym kolorem. Istniejące oznaczenia analizy wpływu i oceny zostają bez zmian.
 */
export function AiBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-amber-600 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
      {label}
    </span>
  );
}

type AiProvenanceProps = {
  label: string;
  provider: string;
  model: string;
  promptVersion: string;
  createdAt: Date;
};

/** Znacznik wyniku: etykieta, model, wersja promptu i data (węzły tekstowe React). */
export function AiProvenance({ label, provider, model, promptVersion, createdAt }: AiProvenanceProps) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
      <AiBadge label={label} />
      <span className="min-w-0 break-words">
        {provider} / {model} · prompt: {promptVersion} · {formatEvaluationDate(createdAt)}
      </span>
    </p>
  );
}

/** Stały tekst ostrzeżenia pod nagłówkiem funkcji AI. */
export function AiNotice({ children }: { children: ReactNode }) {
  return <p className="text-sm text-zinc-600 dark:text-zinc-400">{children}</p>;
}
