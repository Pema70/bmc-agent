import { revalidatePath } from "next/cache";
import { loadAttachmentLimits, type AttachmentLimits } from "@/lib/attachments/config";
import { createFileSystemStorage } from "@/lib/attachments/storage";
import { uploadAttachment, uploadMessages, type UploadErrorCode } from "@/lib/attachments/upload";
import { getProjectAccess } from "@/lib/auth/permissions";

// Zapas na ramki multipart (granice, nagłówki części) ponad rozmiar samego pliku.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const STATUS: Record<UploadErrorCode, number> = {
  EMPTY: 400,
  INVALID_NAME: 400,
  TOO_LARGE: 413,
  LIMIT: 409,
  UNSUPPORTED: 415,
  MISMATCH: 422,
  CORRUPT: 422,
  NO_TEXT: 422,
  ARCHIVE_TOO_LARGE: 422,
  TIMEOUT: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
};

function jsonError(status: number, error: string, message: string): Response {
  return Response.json({ ok: false, error, message }, { status });
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;

  // 1. Sesja i rola EDITOR przed jakimkolwiek odczytem treści żądania i danych projektu.
  const access = await getProjectAccess(id, "EDITOR");
  if (!access.ok) {
    if (access.error === "UNAUTHENTICATED") {
      return jsonError(401, "UNAUTHENTICATED", "Zaloguj się, aby dodawać załączniki.");
    }
    if (access.error === "FORBIDDEN") {
      return jsonError(403, "FORBIDDEN", "Nie masz uprawnień do dodawania załączników w tym projekcie.");
    }
    return jsonError(404, "NOT_FOUND", "Nie znaleziono projektu.");
  }

  let limits: AttachmentLimits;
  try {
    limits = loadAttachmentLimits();
  } catch (error) {
    console.error("[zalaczniki] Błędna konfiguracja:", error instanceof Error ? error.message : "nieznany błąd");
    return jsonError(500, "CONFIG", "Załączniki są źle skonfigurowane. Sprawdź konfigurację serwera.");
  }
  const messages = uploadMessages(limits);

  // 2. Wstępny limit po Content-Length, zanim zbuforujemy ciało żądania (formData() czyta całość do pamięci).
  const declared = Number(req.headers.get("content-length"));
  if (!req.headers.has("content-length") || !Number.isFinite(declared) || declared < 0) {
    return jsonError(411, "LENGTH_REQUIRED", "Nie można ustalić rozmiaru wysyłanego pliku.");
  }
  if (declared > limits.maxBytes + MULTIPART_OVERHEAD_BYTES) {
    return jsonError(413, "TOO_LARGE", messages.TOO_LARGE);
  }

  // 3. Ciało: dokładnie jedno pole „file” z plikiem.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "BAD_REQUEST", "Nieprawidłowe żądanie.");
  }
  const files = form.getAll("file");
  const file = files[0];
  if (files.length !== 1 || !(file instanceof File)) {
    return jsonError(400, "BAD_REQUEST", "Wybierz jeden plik.");
  }

  // Rozmiar sprawdzamy ponownie po odczycie (nagłówek mógł kłamać); dalej limity i kontrole w uploadAttachment.
  if (file.size > limits.maxBytes) {
    return jsonError(413, "TOO_LARGE", messages.TOO_LARGE);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());

  const result = await uploadAttachment(
    { projectId: access.projectId, userId: access.session.user.id, fileName: file.name, bytes },
    { limits, storage: createFileSystemStorage(limits.storageDir) },
  );
  if (!result.ok) {
    return jsonError(STATUS[result.error], result.error, result.message);
  }

  revalidatePath(`/projekty/${access.projectId}`);
  return Response.json({ ok: true, attachment: result.attachment }, { status: 201 });
}
