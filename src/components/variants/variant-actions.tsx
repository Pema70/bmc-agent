"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { createVariantAction, renameVariantAction, setMainVariantAction } from "@/app/projekty/[id]/variant-actions";
import { useOptionalVariantWorkspace } from "@/components/bmc/variant-workspace";
import { VARIANT_NAME_MAX_LENGTH } from "@/lib/schemas/variant";
import { setMainConfirmMessage, switchBlockReason, variantHref } from "@/lib/variants/presentation";

type VariantActionsProps = {
  projectId: string;
  current: { id: string; name: string; isMain: boolean };
  // Id wariantu głównego, który widzi ta strona (null: projekt bez głównego). Serwer porównuje go z bazą.
  mainVariantId: string | null;
  canEdit: boolean;
  isOwner: boolean;
  // Oczekujące propozycje na dotychczasowym wariancie głównym (tylko dla właściciela na wariancie niegłównym).
  pendingOnMain: number;
};

const GENERIC_ERROR = "Nie udało się wykonać operacji. Sprawdź połączenie i spróbuj ponownie.";
const buttonClass =
  "rounded-lg border border-border px-3 py-1.5 text-sm font-bold hover:bg-tint disabled:opacity-50";
const inputClass =
  "min-w-0 flex-1 basis-48 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-text outline-none focus:border-ring";

type Feedback = { kind: "error" | "note"; text: string } | null;

/**
 * Operacje na bieżącym wariancie: kopia i zmiana nazwy (EDITOR+), ustawienie głównego (OWNER).
 * Kopia powstaje z zapisanego stanu (serwer czyta go z bazy), więc przy niezapisanych zmianach jest zablokowana.
 * Zmiana nazwy i ustawienie głównego nie dotykają stanu płótna, więc nie wymagają zapisu. Po akcji strona odświeża się
 * przez revalidatePath na serwerze, a komponenty płótna i czatu zostają zamontowane (klucz zależy tylko od id wariantu).
 */
export function VariantActions({ projectId, current, mainVariantId, canEdit, isOwner, pendingOnMain }: VariantActionsProps) {
  const router = useRouter();
  const workspace = useOptionalVariantWorkspace();
  const dirty = workspace?.dirty ?? false;
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(current.name);
  const [feedback, setFeedback] = useState<Feedback>(null);

  if (!canEdit) {
    return null;
  }

  const copyBlocked = switchBlockReason(dirty);

  function handleCopy() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await createVariantAction(projectId, current.id);
        if (result.ok) {
          router.push(variantHref(projectId, { id: result.variant.id, isMain: false }));
          return;
        }
        setFeedback({ kind: "error", text: result.message });
      } catch (error) {
        console.error("Utworzenie kopii wariantu nie powiodło się", error);
        setFeedback({ kind: "error", text: GENERIC_ERROR });
      }
    });
  }

  function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await renameVariantAction(projectId, current.id, name);
        if (result.ok) {
          setRenaming(false);
          setFeedback({ kind: "note", text: "Zmieniono nazwę wariantu." });
          return;
        }
        setFeedback({ kind: "error", text: result.message });
      } catch (error) {
        console.error("Zmiana nazwy wariantu nie powiodła się", error);
        setFeedback({ kind: "error", text: GENERIC_ERROR });
      }
    });
  }

  function handleSetMain() {
    if (!window.confirm(setMainConfirmMessage({ name: current.name, pendingOnOldMain: pendingOnMain }))) {
      return;
    }
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await setMainVariantAction(projectId, current.id, mainVariantId);
        if (result.ok) {
          // Ten wariant jest teraz główny: adres bez parametru. Id wariantu się nie zmienia, więc nic się nie przemontowuje.
          router.replace(variantHref(projectId, { id: current.id, isMain: true }));
          setFeedback({ kind: "note", text: "Ustawiono wariant główny." });
          return;
        }
        setFeedback({ kind: "error", text: result.message });
      } catch (error) {
        console.error("Ustawienie wariantu głównego nie powiodło się", error);
        setFeedback({ kind: "error", text: GENERIC_ERROR });
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={handleCopy} disabled={pending || copyBlocked !== null} className={buttonClass}>
          Utwórz kopię
        </button>
        <button
          type="button"
          onClick={() => {
            setName(current.name);
            setRenaming((value) => !value);
            setFeedback(null);
          }}
          disabled={pending}
          aria-expanded={renaming}
          className={buttonClass}
        >
          Zmień nazwę
        </button>
        {isOwner && !current.isMain ? (
          <button type="button" onClick={handleSetMain} disabled={pending} className={buttonClass}>
            Ustaw jako główny
          </button>
        ) : null}
        {copyBlocked ? (
          <span role="status" className="text-xs text-medium-fg">
            Kopia z niezapisanego płótna jest zablokowana. {copyBlocked}.
          </span>
        ) : null}
      </div>

      {renaming ? (
        <form onSubmit={handleRename} className="flex flex-wrap gap-2">
          <input
            aria-label="Nowa nazwa wariantu"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={VARIANT_NAME_MAX_LENGTH}
            autoFocus
            className={inputClass}
          />
          <button type="submit" disabled={pending} className={buttonClass}>
            {pending ? "Zapisywanie…" : "Zapisz nazwę"}
          </button>
          <button type="button" onClick={() => setRenaming(false)} disabled={pending} className={buttonClass}>
            Anuluj
          </button>
        </form>
      ) : null}

      {feedback ? (
        <p
          role={feedback.kind === "error" ? "alert" : "status"}
          className={`text-sm ${feedback.kind === "error" ? "text-danger" : "text-low-fg"}`}
        >
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
}
