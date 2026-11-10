import { createIdGenerator, safeValidateUIMessages } from "ai";
import { prisma } from "@/lib/db/client";
import { ChatPartsJson, ClarificationInput, type ChatUIMessage } from "@/lib/schemas/chat";

// Id wiadomości generuje wyłącznie serwer. Typ "brandowany" sprawia, że do zapisu nie da się
// przekazać zwykłego stringa (np. id z żądania klienta), tylko wynik newChatMessageId().
export type ChatMessageId = string & { readonly __brand: "ChatMessageId" };

const generateId = createIdGenerator({ prefix: "msg", size: 24 });

export function newChatMessageId(): ChatMessageId {
  return generateId() as ChatMessageId;
}

const validationTools = {
  ask_clarification: { inputSchema: ClarificationInput, outputSchema: ClarificationInput },
};

/**
 * Historia wspólnego wątku projektu (D2): zawsze filtrowana po projectId, od najstarszej do najnowszej.
 * Uszkodzona wiadomość to błąd danych, który zgłaszamy jawnie zamiast pomijać.
 */
export async function listChatMessages(projectId: string, limit: number): Promise<ChatUIMessage[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: { id: true, role: true, parts: true },
  });
  if (rows.length === 0) {
    return [];
  }

  const candidates = rows
    .reverse()
    .map((row) => ({ id: row.id, role: row.role === "USER" ? "user" : "assistant", parts: row.parts }));

  const validated = await safeValidateUIMessages<ChatUIMessage>({ messages: candidates, tools: validationTools });
  if (!validated.success) {
    throw new Error(`Niepoprawna historia czatu projektu ${projectId}: ${validated.error.message}`);
  }
  return validated.data;
}

export type NewChatMessage = {
  id: ChatMessageId;
  projectId: string;
  userId: string | null;
  role: "user" | "assistant";
  parts: unknown;
};

/**
 * Tylko create (nigdy upsert): wiadomości są niemodyfikowalne, a kolizja id kończy się błędem,
 * zamiast nadpisać cudzą wiadomość.
 */
export async function saveChatMessage(message: NewChatMessage): Promise<void> {
  const parts = ChatPartsJson.parse(message.parts);
  await prisma.chatMessage.create({
    data: {
      id: message.id,
      projectId: message.projectId,
      userId: message.userId,
      role: message.role === "user" ? "USER" : "ASSISTANT",
      parts,
    },
  });
}
