import { tool } from "ai";
import { ClarificationInput } from "@/lib/schemas/chat";

// Argumenty są walidowane schematem Zod przez AI SDK przed wywołaniem execute.
// Wynik to to samo zwalidowane pytanie: UI wyświetla je użytkownikowi, a tura agenta kończy się
// (stopWhen: hasToolCall) i agent czeka na odpowiedź.
export const askClarificationTool = tool({
  description:
    "Zadaj użytkownikowi jedno pytanie doprecyzowujące, gdy brakuje informacji potrzebnych do dalszej pracy nad modelem BMC. Po wywołaniu poczekaj na odpowiedź użytkownika.",
  inputSchema: ClarificationInput,
  execute: async (input) => input,
});

export const chatTools = { ask_clarification: askClarificationTool };
