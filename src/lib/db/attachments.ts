import { prisma } from "@/lib/db/client";
import {
  AttachmentView,
  CreateAttachmentInput,
  type AttachmentWithText,
} from "@/lib/schemas/attachment";

// Każdy odczyt i zapis załącznika jest ograniczony do projektu (projectId pochodzi z uprawnień, nie z żądania).

const VIEW_SELECT = {
  id: true,
  ordinal: true,
  fileName: true,
  kind: true,
  sizeBytes: true,
  textChars: true,
  truncated: true,
  createdAt: true,
} as const;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

class RollbackSignal extends Error {
  constructor(readonly reason: "LIMIT") {
    super(reason);
  }
}

export type CreateAttachmentResult =
  | { ok: true; attachment: AttachmentView }
  | { ok: false; error: "NOT_FOUND" | "LIMIT" | "CONFLICT" };

/**
 * Jedyne miejsce, które tworzy załączniki (id pochodzi z bazy). Jedna transakcja:
 * 1. atomowy `UPDATE … RETURNING` zwiększa licznik Project.attachmentSeq i blokuje wiersz projektu, więc równoległe
 *    wgrania są szeregowane, a limit liczby załączników się nie rozjeżdża;
 * 2. numer (ordinal) to wartość z tego licznika, a nie `count` ani `max` po rekordach: po usunięciu załącznika numer
 *    nigdy nie wraca (w historii czatu zostają odczyty ze starą etykietą Z{n});
 * 3. przy przekroczeniu limitu transakcja się wycofuje, więc licznik nie rośnie.
 * Plik w magazynie zapisuje wywołujący przed tym wywołaniem i sprząta go, gdy wynik nie jest ok.
 */
export async function createAttachment(input: CreateAttachmentInput, maxPerProject: number): Promise<CreateAttachmentResult> {
  const data = CreateAttachmentInput.parse(input);

  try {
    return await prisma.$transaction(async (tx) => {
      const counter = await tx.$queryRaw<Array<{ attachmentSeq: number }>>`
        UPDATE "Project" SET "attachmentSeq" = "attachmentSeq" + 1 WHERE "id" = ${data.projectId} RETURNING "attachmentSeq"`;
      if (counter.length === 0) {
        return { ok: false, error: "NOT_FOUND" } as const;
      }

      const existing = await tx.attachment.count({ where: { projectId: data.projectId } });
      if (existing >= maxPerProject) {
        throw new RollbackSignal("LIMIT");
      }

      const row = await tx.attachment.create({
        data: {
          projectId: data.projectId,
          ordinal: counter[0].attachmentSeq,
          fileName: data.fileName,
          kind: data.kind,
          sizeBytes: data.sizeBytes,
          storageKey: data.storageKey,
          extractedText: data.extractedText,
          textChars: data.extractedText.length,
          truncated: data.truncated,
          createdById: data.createdById,
        },
        select: VIEW_SELECT,
      });
      return { ok: true, attachment: AttachmentView.parse(row) } as const;
    });
  } catch (error) {
    if (error instanceof RollbackSignal) {
      return { ok: false, error: error.reason };
    }
    if (isUniqueViolation(error)) {
      // Kolizja (projectId, ordinal) albo storageKey: nie zapisujemy po cichu, wywołujący sprząta plik.
      return { ok: false, error: "CONFLICT" };
    }
    throw error;
  }
}

/** Lista załączników projektu (bez treści), od najstarszego numeru. */
export async function listAttachmentsForProject(projectId: string): Promise<AttachmentView[]> {
  const rows = await prisma.attachment.findMany({
    where: { projectId },
    orderBy: { ordinal: "asc" },
    select: VIEW_SELECT,
  });
  return rows.map((row) => AttachmentView.parse(row));
}

export async function countAttachments(projectId: string): Promise<number> {
  return prisma.attachment.count({ where: { projectId } });
}

/** Odczyt po id zawsze z filtrem po projekcie: cudze id daje null. Zwraca też wyekstrahowany tekst. */
export async function getAttachmentForProject(projectId: string, attachmentId: string): Promise<AttachmentWithText | null> {
  const row = await prisma.attachment.findFirst({
    where: { id: attachmentId, projectId },
    select: { ...VIEW_SELECT, extractedText: true },
  });
  return row ? { ...AttachmentView.parse(row), extractedText: row.extractedText } : null;
}

/** Odczyt po numerze (etykiecie Z{n}) w projekcie: używa go narzędzie read_attachment (krok 7d). */
export async function getAttachmentByOrdinal(projectId: string, ordinal: number): Promise<AttachmentWithText | null> {
  const row = await prisma.attachment.findFirst({
    where: { projectId, ordinal },
    select: { ...VIEW_SELECT, extractedText: true },
  });
  return row ? { ...AttachmentView.parse(row), extractedText: row.extractedText } : null;
}

export type DeleteAttachmentResult = { ok: true; storageKey: string } | { ok: false; error: "NOT_FOUND" };

/**
 * Usuwa rekord załącznika (tylko po stronie bazy) i zwraca klucz pliku, który wywołujący usuwa z magazynu.
 * Wywoływać wyłącznie na wyraźne polecenie użytkownika w interfejsie. Licznik Project.attachmentSeq zostaje bez
 * zmian, więc numer usuniętego załącznika nie wraca.
 */
export async function deleteAttachment(projectId: string, attachmentId: string): Promise<DeleteAttachmentResult> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.attachment.findFirst({ where: { id: attachmentId, projectId }, select: { storageKey: true } });
    if (!row) {
      return { ok: false, error: "NOT_FOUND" } as const;
    }
    const deleted = await tx.attachment.deleteMany({ where: { id: attachmentId, projectId } });
    if (deleted.count === 0) {
      return { ok: false, error: "NOT_FOUND" } as const;
    }
    return { ok: true, storageKey: row.storageKey } as const;
  });
}
