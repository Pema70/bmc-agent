import { createUIMessageStreamResponse } from "ai";
import { z } from "zod";
import { prepareChatTurn, runChatTurn } from "@/lib/ai/chat-agent";
import { loadAiLimits } from "@/lib/ai/config";
import { getProjectAccess } from "@/lib/auth/permissions";
import { chatRequestSchema } from "@/lib/schemas/chat";

function jsonError(status: number, error: string, message: string, headers?: Record<string, string>): Response {
  return Response.json({ error, message }, { status, headers });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // Najpierw sesja: niezalogowany dostaje 401 także przy zepsutym ciele żądania.
    const probe = await getProjectAccess(undefined, "EDITOR");
    if (!probe.ok && probe.error === "UNAUTHENTICATED") {
      return jsonError(401, "UNAUTHENTICATED", "Zaloguj się, aby rozmawiać z agentem.");
    }
    return jsonError(400, "BAD_REQUEST", "Nieprawidłowe żądanie.");
  }

  // 1. Sesja i rola EDITOR przed jakimkolwiek odczytem danych projektu.
  const rawProjectId = typeof body === "object" && body !== null ? Reflect.get(body, "projectId") : undefined;
  const access = await getProjectAccess(rawProjectId, "EDITOR");
  if (!access.ok) {
    if (access.error === "UNAUTHENTICATED") {
      return jsonError(401, "UNAUTHENTICATED", "Zaloguj się, aby rozmawiać z agentem.");
    }
    if (access.error === "FORBIDDEN") {
      return jsonError(403, "FORBIDDEN", "Nie masz uprawnień do rozmowy z agentem w tym projekcie.");
    }
    return jsonError(404, "NOT_FOUND", "Nie znaleziono projektu.");
  }
  const { projectId, session } = access;
  const userId = session.user.id;

  // 2. Walidacja żądania (strict: żadnych dodatkowych pól, w tym id wiadomości).
  let limits: ReturnType<typeof loadAiLimits>;
  try {
    limits = loadAiLimits();
  } catch (error) {
    console.error("[chat] Błędna konfiguracja limitów:", error instanceof Error ? error.message : "nieznany błąd");
    return jsonError(500, "CONFIG", "Agent jest źle skonfigurowany. Sprawdź konfigurację serwera.");
  }
  const parsed = chatRequestSchema(limits.maxMessageChars).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION", z.prettifyError(parsed.error));
  }
  const request = parsed.data;
  if (request.projectId !== projectId) {
    return jsonError(400, "VALIDATION", "Nieprawidłowe żądanie.");
  }

  // 3 do 6. Wariant, wariant główny, limity użytkownika, model, projekt, historia, załączniki, zapis wiadomości.
  const prepared = await prepareChatTurn({
    projectId,
    userId,
    variantId: request.variantId,
    message: request.message,
    limits,
  });
  if (!prepared.ok) {
    return jsonError(prepared.status, prepared.error, prepared.message, prepared.headers);
  }

  // 7 i 8. Wywołanie modelu, zapis odpowiedzi i log (w `runChatTurn`). Trasa odsyła tylko strumień; `finished` jest dla
  // skryptów, które czekają na koniec zapisu.
  const { stream } = await runChatTurn(prepared.turn, { signal: req.signal });

  return createUIMessageStreamResponse({ stream });
}
