"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { generateStrategiesAction, saveStrategyAsVariantAction } from "@/app/projekty/[id]/strategy-actions";
import { AiBadge, AiNotice, AiProvenance } from "@/components/ai/ai-notice";
import { BmcCanvas } from "@/components/bmc/bmc-canvas";
import { useOptionalVariantWorkspace } from "@/components/bmc/variant-workspace";
import type { StrategyListItem } from "@/lib/db/strategies";
import {
  STRATEGIES_LABEL,
  STRATEGIES_NOTICE,
  candidateEntryCount,
  describeGeneration,
  firstValidGenerationId,
  isStrategyStale,
  mergeStrategyItems,
  strategyItemId,
} from "@/lib/strategies/presentation";
import { STRATEGY_GUIDELINES_MAX_LENGTH, type StrategyGenerationView } from "@/lib/schemas/strategy";
import type { Strategy } from "@/lib/schemas/variant";
import { switchBlockReason, variantHref } from "@/lib/variants/presentation";

type Props = {
  projectId: string;
  variantId: string;
  canGenerate: boolean;
  // Wersja wariantu z serwera w chwili renderu; z edytora (EDITOR+) bierzemy bieżącą.
  currentVersion: number;
  initialItems: StrategyListItem[];
};

type SavedInfo = { variantId: string; name: string | null };

const GENERIC_ERROR = "Nie udało się wykonać operacji. Sprawdź połączenie i spróbuj ponownie.";
const buttonClass =
  "rounded-lg border border-border px-3 py-1.5 text-sm font-bold hover:bg-tint disabled:opacity-50";

const savedKey = (generationId: string, index: number) => `${generationId}:${index}`;

/**
 * Panel strategii: formularz wytycznych, kandydaci z podglądem i zapisem jako wariant, historia generacji.
 * Wynik to kandydaci, a nie warianty: wariant powstaje po kliknięciu „Zapisz jako wariant” (EDITOR+).
 * Wszystkie treści (nazwy, założenia, wpisy, wytyczne, model) to węzły tekstowe React, bez HTML i Markdown.
 * Nowe elementy po odświeżeniu strony dołączane są z propsów bez remountu (jak w ImpactProvider), więc panel
 * nie wymaga `key` zależnego od listy i nie dotyka płótna ani czatu.
 */
export function StrategiesPanel({ projectId, variantId, canGenerate, currentVersion, initialItems }: Props) {
  const workspace = useOptionalVariantWorkspace();
  const dirty = workspace?.dirty ?? false;
  const version = workspace?.version ?? currentVersion;
  const dirtyReason = switchBlockReason(dirty);

  const [items, setItems] = useState<StrategyListItem[]>(initialItems);
  const [selectedId, setSelectedId] = useState<string | null>(() => firstValidGenerationId(initialItems));
  const [guidelines, setGuidelines] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, SavedInfo>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  // Chroni przed podwójnym uruchomieniem w tej samej chwili (stan React aktualizuje się asynchronicznie).
  const runningRef = useRef(false);

  // Po odświeżeniu strony (np. po zapisie w innej karcie) serwer przekazuje świeżą listę: dołączamy brakujące
  // generacje i zapisane warianty, bez remountu. Najnowsza nowa generacja zostaje wybrana.
  const [seenInitial, setSeenInitial] = useState(initialItems);
  if (seenInitial !== initialItems) {
    setSeenInitial(initialItems);
    const known = new Set(items.map(strategyItemId));
    const newest = initialItems.find((item) => item.ok && !known.has(item.generation.id));
    setItems(mergeStrategyItems(items, initialItems));
    if (newest?.ok) {
      setSelectedId(newest.generation.id);
    }
  }

  const busy = generating || savingKey !== null;
  const selected = items.find((item) => item.ok && item.generation.id === selectedId);
  const generation = selected?.ok ? selected.generation : null;

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (runningRef.current || dirty || !canGenerate) {
      return;
    }
    runningRef.current = true;
    setGenerating(true);
    setGenerateError(null);
    try {
      const result = await generateStrategiesAction(projectId, variantId, guidelines);
      if (result.ok) {
        setItems((current) => mergeStrategyItems(current, [{ ok: true, generation: result.generation }]));
        setSelectedId(result.generation.id);
        setGuidelines("");
      } else {
        setGenerateError(result.message);
      }
    } catch (error) {
      console.error("Generowanie strategii nie powiodło się", error);
      setGenerateError(GENERIC_ERROR);
    } finally {
      runningRef.current = false;
      setGenerating(false);
    }
  }

  async function save(generationId: string, index: number) {
    if (runningRef.current || !canGenerate) {
      return;
    }
    const key = savedKey(generationId, index);
    runningRef.current = true;
    setSavingKey(key);
    setSaveErrors((current) => omit(current, key));
    try {
      const result = await saveStrategyAsVariantAction(projectId, variantId, generationId, index);
      if (result.ok) {
        setSaved((current) => ({ ...current, [key]: { variantId: result.variant.id, name: result.variant.name } }));
      } else if (result.error === "ALREADY_SAVED") {
        // Już zapisana (np. w drugiej karcie): to nie błąd, pokazujemy link do istniejącego wariantu.
        setSaved((current) => ({ ...current, [key]: { variantId: result.variantId, name: null } }));
      } else {
        setSaveErrors((current) => ({ ...current, [key]: result.message }));
      }
    } catch (error) {
      console.error("Zapis strategii jako wariantu nie powiódł się", error);
      setSaveErrors((current) => ({ ...current, [key]: GENERIC_ERROR }));
    } finally {
      runningRef.current = false;
      setSavingKey(null);
    }
  }

  function savedFor(source: StrategyGenerationView, index: number): SavedInfo | null {
    const local = saved[savedKey(source.id, index)];
    if (local) {
      return local;
    }
    const fromServer = source.savedVariants.find((variant) => variant.index === index);
    return fromServer ? { variantId: fromServer.variantId, name: fromServer.name } : null;
  }

  const trimmedLength = guidelines.trim().length;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="strategies-heading">
      <div className="flex flex-wrap items-center gap-3">
        <h3 id="strategies-heading" className="text-base font-semibold">
          Strategie
        </h3>
        <AiBadge label={STRATEGIES_LABEL} />
      </div>

      <AiNotice>{STRATEGIES_NOTICE}</AiNotice>

      {canGenerate ? (
        <form onSubmit={generate} className="flex max-w-2xl flex-col items-start gap-3">
          <label className="flex w-full flex-col gap-1 text-sm">
            <span className="font-medium">Wytyczne (opcjonalnie)</span>
            <textarea
              value={guidelines}
              onChange={(event) => setGuidelines(event.target.value)}
              maxLength={STRATEGY_GUIDELINES_MAX_LENGTH}
              rows={3}
              disabled={busy}
              placeholder="np. skup się na klientach firmowych"
              className="rounded-lg border border-border bg-transparent px-2 py-1.5"
            />
            <span className="text-xs text-muted">
              {trimmedLength}/{STRATEGY_GUIDELINES_MAX_LENGTH} znaków
            </span>
          </label>
          <button
            type="submit"
            disabled={busy || dirty}
            className="rounded-lg bg-cta px-4 py-2 text-sm font-bold hover:bg-tint disabled:opacity-50"
          >
            {generating ? "Generuję…" : "Generuj strategie"}
          </button>
          {dirtyReason ? <p className="text-sm text-muted">{dirtyReason}</p> : null}
          {generateError ? (
            <p role="alert" className="text-sm text-danger">
              {generateError}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="text-sm text-muted">
          Generowanie i zapisywanie strategii jest dostępne dla edytorów i właścicieli projektu.
        </p>
      )}

      {generation ? (
        <div className="flex flex-col gap-3">
          <AiProvenance
            label={STRATEGIES_LABEL}
            provider={generation.provider}
            model={generation.model}
            promptVersion={generation.promptVersion}
            createdAt={generation.createdAt}
          />
          {isStrategyStale(generation.variantVersion, version) ? (
            <p className="text-sm text-medium-fg">
              Wynik dotyczy wersji {generation.variantVersion} wariantu, aktualna to {version}.
            </p>
          ) : null}
          <p className="whitespace-pre-wrap break-words text-sm">
            <span className="font-medium">Wytyczne: </span>
            {generation.guidelines ?? "brak"}
          </p>
          <ul className="flex flex-col gap-3">
            {generation.result.strategies.map((strategy, index) => {
              const key = savedKey(generation.id, index);
              return (
                <CandidateCard
                  key={key}
                  projectId={projectId}
                  strategy={strategy}
                  saved={savedFor(generation, index)}
                  canSave={canGenerate}
                  busy={busy}
                  saving={savingKey === key}
                  linkBlockedReason={dirtyReason}
                  error={saveErrors[key] ?? null}
                  onSave={() => void save(generation.id, index)}
                />
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted">
          {items.length === 0 ? "Ten wariant nie ma jeszcze wygenerowanych strategii." : "Wybierz generację z historii."}
        </p>
      )}

      {items.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">Historia generowania</h4>
          <ul className="flex flex-col gap-1">
            {items.map((item) =>
              item.ok ? (
                <li key={item.generation.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.generation.id)}
                    aria-pressed={item.generation.id === selectedId}
                    className="w-full rounded-lg border border-border px-3 py-1.5 text-left text-sm break-words hover:bg-tint aria-pressed:border-primary-from aria-pressed:font-medium"
                  >
                    {describeGeneration(item.generation)}
                  </button>
                </li>
              ) : (
                <li
                  key={item.id}
                  className="rounded-lg border border-danger px-3 py-1.5 text-sm break-words text-danger"
                >
                  Nie można wyświetlić zapisanych strategii ({item.id}): {item.error}
                </li>
              ),
            )}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function omit(record: Record<string, string>, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));
}

type CandidateCardProps = {
  projectId: string;
  strategy: Strategy;
  saved: SavedInfo | null;
  canSave: boolean;
  busy: boolean;
  saving: boolean;
  // Przy niezapisanych zmianach płótna link do wariantu jest zablokowany (przejście przemontowałoby edytor).
  linkBlockedReason: string | null;
  error: string | null;
  onSave: () => void;
};

function CandidateCard({ projectId, strategy, saved, canSave, busy, saving, linkBlockedReason, error, onSave }: CandidateCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h5 className="min-w-0 break-words font-semibold">{strategy.name}</h5>
        <AiBadge label={STRATEGIES_LABEL} />
        <span className="text-xs text-muted">wpisów: {candidateEntryCount(strategy.state)}</span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">
        <span className="font-medium">Założenie: </span>
        {strategy.assumption}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setPreviewOpen((open) => !open)} aria-expanded={previewOpen} className={buttonClass}>
          {previewOpen ? "Ukryj podgląd" : "Pokaż podgląd"}
        </button>
        {saved ? (
          <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">
              {saved.name ? `Zapisano jako wariant „${saved.name}”.` : "Ta strategia jest już zapisana jako wariant."}
            </span>
            {linkBlockedReason ? (
              <span className="text-muted">{linkBlockedReason}, aby przejść do wariantu.</span>
            ) : (
              <Link href={variantHref(projectId, { id: saved.variantId, isMain: false })} className="font-medium underline">
                Otwórz wariant
              </Link>
            )}
          </span>
        ) : canSave ? (
          <button type="button" onClick={onSave} disabled={busy} className={buttonClass}>
            {saving ? "Zapisuję…" : "Zapisz jako wariant"}
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {previewOpen ? <BmcCanvas state={strategy.state} showImpact={false} /> : null}
    </li>
  );
}
