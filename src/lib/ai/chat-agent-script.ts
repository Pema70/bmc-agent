import { prepareChatTurnCore, type ChatTurn, type ChatTurnRejection, type PrepareChatTurnInput } from "@/lib/ai/chat-agent";

/**
 * Wariant `prepareChatTurn` dla skryptu ewaluacji (krok 10, PR 10f): bez limitów użytkownika (żądania na godzinę
 * i tokeny na dobę). Reszta kroków i kolejność odczytów oraz zapisów są takie same jak w `prepareChatTurn`.
 *
 * Tylko dla skryptów uruchamianych przez właściciela. Trasy w `src/app/**` nie mogą tego modułu importować
 * (pilnuje tego test w `chat-agent-script.test.ts`); operacje wewnątrz tury (np. `evaluate_bmc`) sprawdzają limity
 * same, dlatego skrypt podnosi też limity w swoim procesie (`applyScriptLimitOverrides` w `src/lib/eval/script-limits.ts`).
 */
export async function prepareChatTurnWithoutUserLimits(
  input: PrepareChatTurnInput,
): Promise<{ ok: true; turn: ChatTurn } | ChatTurnRejection> {
  return prepareChatTurnCore(input, { enforceUserLimits: false });
}
