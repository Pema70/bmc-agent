"use client";

import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { saveCanvasAction } from "@/app/projekty/[id]/actions";
import { BLOCK_CARD_BASE, BLOCK_PLACEMENT, CANVAS_GRID } from "@/components/bmc/layout";
import { useVariantWorkspace } from "@/components/bmc/variant-workspace";
import { ProposalCard } from "@/components/chat/proposal-card";
import { ImpactCanvasBanner } from "@/components/impact/canvas-banner";
import { ImpactBadge, ImpactDetails, impactBorderClass, useBlockImpact } from "@/components/impact/block-impact";
import { proposalDiffForBlock, type BlockDiff } from "@/lib/bmc/diff";
import {
  addEntry,
  countChanges,
  remainingInBlock,
  remainingTotal,
  removeEntry,
  updateEntry,
  type EditResult,
} from "@/lib/bmc/state";
import {
  BLOCK_INFO,
  BLOCK_KEYS,
  BMC_ENTRY_MAX_LENGTH,
  MAX_ENTRIES_PER_BLOCK,
  MAX_ENTRIES_TOTAL,
  countEntries,
  type BlockKey,
  type BmcState,
} from "@/lib/schemas/bmc";

type SaveStatus = { kind: "saved" | "error" | "conflict"; message: string } | null;

const inputClass =
  "min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-zinc-900 aria-invalid:border-red-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-300";
const smallButtonClass =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function CanvasEditor() {
  // Wersja, stan zapisany na serwerze i propozycje są wspólne z czatem (VariantWorkspaceProvider).
  const workspace = useVariantWorkspace();
  const { projectId, variantId, version, serverState: saved, adoptRevision, setDirty, onSaved } = workspace;

  const [current, setCurrent] = useState<BmcState>(saved);
  const [status, setStatus] = useState<SaveStatus>(null);
  const [pending, startTransition] = useTransition();
  const [adoptedRevision, setAdoptedRevision] = useState(adoptRevision);

  // Po akceptacji propozycji przejmujemy zwrócony stan bez przeładowania strony. Akceptacja jest
  // zablokowana przy niezapisanych zmianach, a na czas żądania edytor jest zablokowany (locked),
  // więc lokalne zmiany nie giną.
  if (adoptedRevision !== adoptRevision) {
    setAdoptedRevision(adoptRevision);
    setCurrent(saved);
    setStatus(null);
  }

  const locked = workspace.busy?.kind === "accept";
  const changes = countChanges(saved, current);
  const dirty = changes > 0;
  const total = countEntries(current);

  // Oczekujące propozycje w kolejności powstawania (rekordy z bazy pochodzą od najstarszej).
  const pendingProposals = useMemo(
    () => Object.values(workspace.proposals).filter((proposal) => proposal.status === "PENDING"),
    [workspace.proposals],
  );

  useEffect(() => {
    setDirty(dirty);
  }, [dirty, setDirty]);

  useEffect(() => () => setDirty(false), [setDirty]);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Starsze przeglądarki wymagają ustawienia returnValue, by pokazać ostrzeżenie.
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  function apply(result: EditResult): string | null {
    if (!result.ok) {
      return result.error;
    }
    setCurrent(result.state);
    if (status?.kind === "saved") {
      setStatus(null);
    }
    return null;
  }

  function handleSave() {
    const stateToSave = current;
    startTransition(async () => {
      try {
        const result = await saveCanvasAction(projectId, variantId, version, stateToSave);
        if (result.ok) {
          onSaved(result.version, result.state);
          setStatus({ kind: "saved", message: "Zapisano zmiany." });
          return;
        }
        // Przy konflikcie i każdym innym błędzie lokalne zmiany zostają na ekranie.
        setStatus({ kind: result.error === "VERSION_CONFLICT" ? "conflict" : "error", message: result.message });
      } catch (error) {
        console.error("Zapis płótna nie powiódł się", error);
        setStatus({ kind: "error", message: "Nie udało się zapisać. Sprawdź połączenie i spróbuj ponownie." });
      }
    });
  }

  function handleRevert() {
    if (!dirty || !window.confirm("Cofnąć wszystkie niezapisane zmiany?")) {
      return;
    }
    setCurrent(saved);
    setStatus(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-zinc-200 bg-white/95 px-4 py-3 text-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <span>
          Wpisy:{" "}
          <strong>
            {total}/{MAX_ENTRIES_TOTAL}
          </strong>{" "}
          <span className="text-zinc-500">(zostało {remainingTotal(current)})</span>
        </span>
        <span aria-live="polite">
          Niezapisane zmiany: <strong>{changes}</strong>
        </span>
        {pendingProposals.length > 0 ? (
          <span aria-live="polite">
            Propozycje AI do rozpatrzenia: <strong>{pendingProposals.length}</strong>
          </span>
        ) : null}
        <button
          type="button"
          onClick={handleRevert}
          disabled={!dirty || pending || locked}
          className={`ml-auto ${smallButtonClass} px-3 py-2 text-sm`}
        >
          Cofnij zmiany
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || pending || locked}
          className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Zapisywanie…" : "Zapisz"}
        </button>
        {status ? (
          <p
            role={status.kind === "saved" ? "status" : "alert"}
            className={`w-full ${status.kind === "saved" ? "text-green-700" : "text-red-600"}`}
          >
            {status.message}
          </p>
        ) : null}
      </div>

      <ImpactCanvasBanner />

      <div className={CANVAS_GRID}>
        {BLOCK_KEYS.map((key) => (
          <BlockEditor
            key={key}
            blockKey={key}
            entries={current[key]}
            remainingBlock={remainingInBlock(current, key)}
            remainingTotal={remainingTotal(current)}
            diff={proposalDiffForBlock(current, key, pendingProposals)}
            locked={locked}
            onAdd={(text) => apply(addEntry(current, key, text))}
            onUpdate={(index, text) => apply(updateEntry(current, key, index, text))}
            onRemove={(index) => apply(removeEntry(current, key, index))}
          />
        ))}
      </div>
    </div>
  );
}

type BlockEditorProps = {
  blockKey: BlockKey;
  entries: string[];
  remainingBlock: number;
  remainingTotal: number;
  diff: BlockDiff;
  // Na czas stosowania propozycji edycja jest zablokowana.
  locked: boolean;
  onAdd: (text: string) => string | null;
  onUpdate: (index: number, text: string) => string | null;
  onRemove: (index: number) => string | null;
};

function BlockEditor({
  blockKey,
  entries,
  remainingBlock,
  remainingTotal,
  diff,
  locked,
  onAdd,
  onUpdate,
  onRemove,
}: BlockEditorProps) {
  const [draft, setDraft] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canAdd = remainingBlock > 0 && remainingTotal > 0 && !locked;
  const proposalCount =
    diff.additions.length + diff.stale.length + diff.entries.reduce((sum, entry) => sum + entry.proposals.length, 0);
  // Wpływ działa na ramkę i nagłówek bloku; diff propozycji zostaje wewnątrz wpisów.
  const impact = useBlockImpact(blockKey);
  const headingId = `block-${blockKey}`;
  const errorId = `block-${blockKey}-error`;

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = onAdd(draft);
    setError(result);
    if (!result) {
      setDraft("");
    }
  }

  function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editingIndex === null) {
      return;
    }
    const result = onUpdate(editingIndex, editText);
    setError(result);
    if (!result) {
      setEditingIndex(null);
    }
  }

  function startEditing(index: number) {
    setEditingIndex(index);
    setEditText(entries[index] ?? "");
    setError(null);
  }

  function handleRemove(index: number) {
    setError(onRemove(index));
    if (editingIndex !== null) {
      setEditingIndex(null);
    }
  }

  return (
    <section aria-labelledby={headingId} className={`${BLOCK_CARD_BASE} ${impactBorderClass(impact)} ${BLOCK_PLACEMENT[blockKey]}`}
    >
      <header className="flex flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 id={headingId} className="text-sm font-semibold">
            {BLOCK_INFO[blockKey].label}
          </h3>
          <span
            className={`shrink-0 text-xs ${remainingBlock === 0 ? "text-red-600" : "text-zinc-500"}`}
            title={`Zostało ${remainingBlock} z ${MAX_ENTRIES_PER_BLOCK} wpisów w bloku`}
          >
            {entries.length}/{MAX_ENTRIES_PER_BLOCK}
          </span>
        </div>
        <ImpactBadge state={impact} />
        {proposalCount > 0 ? (
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
            Propozycje AI w bloku: {proposalCount}
          </p>
        ) : null}
        <p className="text-xs text-zinc-500">{BLOCK_INFO[blockKey].description}</p>
      </header>
      <ImpactDetails state={impact} />

      {entries.length === 0 ? (
        <p className="text-sm text-zinc-400 italic">Brak wpisów.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {entries.map((entry, index) =>
            editingIndex === index ? (
              <li key={index}>
                <form onSubmit={handleUpdate} className="flex flex-wrap gap-1">
                  <input
                    aria-label={`Edytuj wpis ${index + 1}`}
                    value={editText}
                    onChange={(event) => setEditText(event.target.value)}
                    maxLength={BMC_ENTRY_MAX_LENGTH}
                    autoFocus
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    className={inputClass}
                  />
                  <button type="submit" className={smallButtonClass}>
                    OK
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingIndex(null);
                      setError(null);
                    }}
                    className={smallButtonClass}
                  >
                    Anuluj
                  </button>
                </form>
              </li>
            ) : (
              <li key={index} className="flex flex-col gap-1">
                <div className="group flex items-start gap-1">
                  <span
                    className={`min-w-0 flex-1 break-words before:mr-1 before:content-['•'] ${
                      diff.entries[index]?.status !== "unchanged"
                        ? "rounded bg-red-100 px-1 text-red-900 line-through dark:bg-red-950/50 dark:text-red-200"
                        : ""
                    }`}
                  >
                    {entry}
                  </span>
                  <button
                    type="button"
                    onClick={() => startEditing(index)}
                    disabled={locked}
                    aria-label={`Edytuj wpis: ${entry}`}
                    className="shrink-0 text-xs text-zinc-500 hover:underline disabled:opacity-50"
                  >
                    Edytuj
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(index)}
                    disabled={locked}
                    aria-label={`Usuń wpis: ${entry}`}
                    className="shrink-0 text-xs text-red-600 hover:underline disabled:opacity-50"
                  >
                    Usuń
                  </button>
                </div>
                {diff.entries[index]?.proposals.map((proposal) => (
                  <ProposalCard key={proposal.id} proposal={proposal} status={proposal.status} compact />
                ))}
              </li>
            ),
          )}
        </ul>
      )}

      {diff.additions.length > 0 || diff.stale.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {diff.additions.map((proposal) => (
            <li key={proposal.id}>
              <ProposalCard proposal={proposal} status={proposal.status} compact />
            </li>
          ))}
          {diff.stale.map(({ proposal }) => (
            <li key={proposal.id}>
              <ProposalCard proposal={proposal} status={proposal.status} compact />
            </li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={handleAdd} className="mt-auto flex gap-1">
        <input
          aria-label={`Nowy wpis: ${BLOCK_INFO[blockKey].label}`}
          placeholder={canAdd ? "Nowy wpis…" : "Osiągnięto limit wpisów"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={BMC_ENTRY_MAX_LENGTH}
          disabled={!canAdd}
          aria-invalid={error && editingIndex === null ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={inputClass}
        />
        <button type="submit" disabled={!canAdd} className={smallButtonClass}>
          Dodaj
        </button>
      </form>

      {error ? (
        <p id={errorId} role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </section>
  );
}
