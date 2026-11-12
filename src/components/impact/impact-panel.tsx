"use client";

import { useState, type FormEvent } from "react";
import { DIRTY_MESSAGE } from "@/components/bmc/variant-workspace";
import { ImpactNotice, ImpactResult } from "@/components/impact/impact-result";
import { useImpact } from "@/components/impact/impact-provider";
import { formatEvaluationDate } from "@/lib/evaluation/format";
import { describeChange } from "@/lib/impact/format";
import { BLOCK_INFO, BLOCK_KEYS, type BlockKey } from "@/lib/schemas/bmc";
import { IMPACT_DESCRIPTION_MAX_LENGTH, IMPACT_DESCRIPTION_MIN_LENGTH } from "@/lib/schemas/impact";

const canvasButtonClass =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function ImpactPanel() {
  const impact = useImpact();
  const [blockKey, setBlockKey] = useState<BlockKey>(BLOCK_KEYS[0]);
  const [description, setDescription] = useState("");

  const busy = impact.pendingScope !== null;
  const trimmedLength = description.trim().length;
  const validDescription = trimmedLength >= IMPACT_DESCRIPTION_MIN_LENGTH && trimmedLength <= IMPACT_DESCRIPTION_MAX_LENGTH;
  const formError = impact.error?.scope === "form" ? impact.error.text : null;

  const selected = impact.items.find((item) => item.ok && item.analysis.id === impact.selectedId);
  const analysis = selected?.ok ? selected.analysis : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || impact.dirty || !validDescription) {
      return;
    }
    const ok = await impact.analyze("form", { kind: "DESCRIPTION", blockKey, description });
    if (ok) {
      setDescription("");
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="impact-heading">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="impact-heading" className="text-lg font-semibold">
          Analiza wpływu zmiany
        </h2>
        <span className="rounded-full border border-amber-600 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
          Analiza AI
        </span>
      </div>

      <ImpactNotice />

      {impact.canAnalyze ? (
        <form onSubmit={submit} className="flex max-w-2xl flex-col items-start gap-3">
          <h3 className="text-sm font-semibold">Co jeśli…?</h3>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Zmieniany blok</span>
            <select
              value={blockKey}
              onChange={(event) => setBlockKey(event.target.value as BlockKey)}
              disabled={busy}
              className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
            >
              {BLOCK_KEYS.map((key) => (
                <option key={key} value={key} className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
                  {BLOCK_INFO[key].label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-full flex-col gap-1 text-sm">
            <span className="font-medium">Opis zmiany</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={IMPACT_DESCRIPTION_MAX_LENGTH}
              rows={3}
              disabled={busy}
              placeholder="np. sprzedaż wyłącznie przez sklep internetowy"
              className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
            />
            <span className="text-xs text-zinc-500">
              {trimmedLength}/{IMPACT_DESCRIPTION_MAX_LENGTH} znaków (minimum {IMPACT_DESCRIPTION_MIN_LENGTH})
            </span>
          </label>
          <button
            type="submit"
            disabled={busy || impact.dirty || !validDescription}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {impact.pendingScope === "form" ? "Analizuję…" : "Analizuj wpływ"}
          </button>
          {impact.dirty ? <p className="text-sm text-zinc-600 dark:text-zinc-400">{DIRTY_MESSAGE}</p> : null}
          {formError ? (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {formError}
            </p>
          ) : null}
        </form>
      ) : null}

      {analysis ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {impact.activeId === analysis.id ? (
              <button type="button" onClick={impact.hide} className={canvasButtonClass}>
                Ukryj analizę
              </button>
            ) : (
              <button type="button" onClick={() => impact.show(analysis.id)} className={canvasButtonClass}>
                Pokaż na płótnie
              </button>
            )}
          </div>
          <ImpactResult analysis={analysis} currentVersion={impact.currentVersion} />
        </div>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {impact.items.length === 0 ? "Ten wariant nie ma jeszcze żadnej analizy wpływu." : "Wybierz analizę z historii."}
        </p>
      )}

      {impact.items.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Historia analiz</h3>
          <ul className="flex flex-col gap-1">
            {impact.items.map((item) =>
              item.ok ? (
                <li key={item.analysis.id}>
                  <button
                    type="button"
                    onClick={() => impact.select(item.analysis.id)}
                    aria-pressed={item.analysis.id === impact.selectedId}
                    className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-left text-sm break-words hover:bg-zinc-100 aria-pressed:border-zinc-900 aria-pressed:font-medium dark:border-zinc-700 dark:hover:bg-zinc-800 dark:aria-pressed:border-zinc-300"
                  >
                    {formatEvaluationDate(item.analysis.createdAt)} · {describeChange(item.analysis.change)}
                  </button>
                </li>
              ) : (
                <li
                  key={item.id}
                  className="rounded-md border border-red-600 px-3 py-1.5 text-sm text-red-700 dark:text-red-400"
                >
                  Nie można wyświetlić zapisanej analizy ({item.id}): {item.error}
                </li>
              ),
            )}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
