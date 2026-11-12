import type { UIDataTypes, UIMessage } from "ai";
import { z } from "zod";
import { VariantId } from "@/lib/schemas/bmc";
import { EvaluateBmcOutput } from "@/lib/schemas/evaluation";
import { ProjectId } from "@/lib/schemas/project";
import {
  ProposeBlockChangeInput,
  ProposeBlockChangeOutput,
  type ProposeBlockChangeToolInput,
} from "@/lib/schemas/proposal";

// Domyślny limit długości wiadomości; serwer egzekwuje wartość z CHAT_MAX_MESSAGE_CHARS (src/lib/ai/config.ts).
export const CHAT_MESSAGE_MAX_CHARS = 4000;
export const CLARIFICATION_QUESTION_MAX_CHARS = 500;
export const CLARIFICATION_ANSWER_MAX_CHARS = 200;
export const CLARIFICATION_MAX_SUGGESTIONS = 5;

/**
 * Żądanie do /api/chat: tylko tekst nowej wiadomości. Klient nie wysyła historii ani identyfikatorów
 * wiadomości (D3), a strictObject odrzuca każde dodatkowe pole, np. próbę narzucenia własnego `id`.
 */
export function chatRequestSchema(maxMessageChars: number = CHAT_MESSAGE_MAX_CHARS) {
  return z.strictObject({
    projectId: ProjectId,
    variantId: VariantId,
    message: z
      .string({ error: "Wiadomość musi być tekstem." })
      .trim()
      .min(1, { error: "Wiadomość nie może być pusta." })
      .max(maxMessageChars, { error: `Wiadomość może mieć najwyżej ${maxMessageChars} znaków.` }),
  });
}
export type ChatRequest = z.infer<ReturnType<typeof chatRequestSchema>>;

export const ClarificationInput = z.object({
  question: z
    .string()
    .trim()
    .min(1)
    .max(CLARIFICATION_QUESTION_MAX_CHARS)
    .describe("Jedno konkretne pytanie do użytkownika, po polsku."),
  suggestedAnswers: z
    .array(z.string().trim().min(1).max(CLARIFICATION_ANSWER_MAX_CHARS))
    .max(CLARIFICATION_MAX_SUGGESTIONS)
    .optional()
    .describe("Opcjonalne krótkie propozycje odpowiedzi, z których użytkownik może wybrać."),
});
export type ClarificationInput = z.infer<typeof ClarificationInput>;

// Typy narzędzi dla UI (współdzielone z komponentem klienckim bez importu kodu serwerowego).
export type ChatTools = {
  ask_clarification: { input: ClarificationInput; output: ClarificationInput };
  propose_block_change: { input: ProposeBlockChangeToolInput; output: ProposeBlockChangeOutput };
  evaluate_bmc: { input: Record<string, never>; output: EvaluateBmcOutput };
};

// Schematy narzędzi do walidacji zapisanych wiadomości (historia z bazy, odpowiedź przed zapisem).
export const chatValidationTools = {
  ask_clarification: { inputSchema: ClarificationInput, outputSchema: ClarificationInput },
  propose_block_change: { inputSchema: ProposeBlockChangeInput, outputSchema: ProposeBlockChangeOutput },
  evaluate_bmc: { inputSchema: z.object({}), outputSchema: EvaluateBmcOutput },
};
export type ChatUIMessage = UIMessage<unknown, UIDataTypes, ChatTools>;

// Kształt części wiadomości zapisywanych w ChatMessage.parts (pełną walidację robi validateUIMessages).
export const ChatPartsJson = z.array(
  z.record(z.string(), z.json()).refine((part) => typeof part.type === "string", { error: "Część bez typu." }),
);
