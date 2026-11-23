"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { deleteAttachmentAction } from "@/app/projekty/[id]/attachment-actions";
import { formatFileSize, uploadErrorMessage, UPLOAD_GENERIC_ERROR } from "@/lib/attachments/format";
import { attachmentLabel } from "@/lib/schemas/attachment";

export type AttachmentListItem = {
  id: string;
  ordinal: number;
  fileName: string;
  kind: "PDF" | "DOCX" | "TXT";
  sizeBytes: number;
  textChars: number;
  truncated: boolean;
  createdAt: string;
};

type Props = {
  projectId: string;
  canEdit: boolean;
  items: AttachmentListItem[];
  maxPerProject: number;
  maxMegabytes: number;
};

const DATE_FORMAT = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw" });

// Nazwy plików i wszystkie treści z serwera są renderowane wyłącznie jako węzły tekstowe React.
export function AttachmentsPanel({ projectId, canEdit, items, maxPerProject, maxMegabytes }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const limitReached = items.length >= maxPerProject;

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`/api/projekty/${projectId}/zalaczniki`, { method: "POST", body });
      if (response.ok) {
        router.refresh();
        return;
      }
      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      setError(uploadErrorMessage(parsed));
    } catch (caught) {
      console.error("Wgranie załącznika nie powiodło się", caught);
      setError(UPLOAD_GENERIC_ERROR);
    } finally {
      setUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  function remove(attachmentId: string) {
    setError(null);
    setDeletingId(attachmentId);
    startTransition(async () => {
      try {
        const result = await deleteAttachmentAction(projectId, attachmentId);
        if (result.ok) {
          setConfirmingId(null);
          router.refresh();
        } else {
          setError(result.message);
        }
      } catch (caught) {
        console.error("Usunięcie załącznika nie powiodło się", caught);
        setError("Nie udało się usunąć załącznika. Spróbuj ponownie.");
      } finally {
        setDeletingId(null);
      }
    });
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="attachments-heading">
      <h2 id="attachments-heading" className="text-lg font-semibold">
        Załączniki
      </h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Pliki PDF (z warstwą tekstową), DOCX i TXT (UTF-8), do {maxMegabytes} MB każdy, najwyżej {maxPerProject} w projekcie.
        Z pliku zapisujemy wyłącznie tekst. Skany bez warstwy tekstowej nie są obsługiwane. Załączniki mają stałe numery
        (Z1, Z2, …), które nie wracają po usunięciu pliku.
      </p>

      {canEdit ? (
        <div className="flex flex-col items-start gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Dodaj plik</span>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              disabled={uploading || limitReached}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void upload(file);
                }
              }}
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white disabled:opacity-50 dark:file:bg-zinc-100 dark:file:text-zinc-900"
            />
          </label>
          {uploading ? <p className="text-sm text-zinc-600 dark:text-zinc-400">Wgrywanie i odczyt tekstu…</p> : null}
          {limitReached ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Osiągnięto limit załączników. Usuń któryś, żeby dodać kolejny.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">Brak załączników.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="min-w-0 break-words font-medium">
                  {attachmentLabel(item.ordinal)}: {item.fileName}
                </span>
                <span className="shrink-0 text-xs text-zinc-500">
                  {item.kind} · {formatFileSize(item.sizeBytes)} · {item.textChars} znaków ·{" "}
                  {DATE_FORMAT.format(new Date(item.createdAt))}
                </span>
              </div>
              {item.truncated ? (
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Tekst został przycięty do limitu; agent zobaczy tylko jego początek.
                </p>
              ) : null}
              {canEdit ? (
                confirmingId === item.id ? (
                  <div className="flex flex-col gap-2" role="group" aria-label={`Potwierdzenie usunięcia: ${item.fileName}`}>
                    <p>
                      Usunąć załącznik {attachmentLabel(item.ordinal)}: {item.fileName}? Tego nie można cofnąć.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => remove(item.id)}
                        disabled={deletingId === item.id}
                        className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                      >
                        {deletingId === item.id ? "Usuwanie…" : "Potwierdź usunięcie"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        disabled={deletingId === item.id}
                        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        Anuluj
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setConfirmingId(item.id);
                      }}
                      className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      Usuń
                    </button>
                  </div>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
