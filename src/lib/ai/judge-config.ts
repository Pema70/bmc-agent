import { loadModelConfig } from "@/lib/ai/models";

/** Czy sędzia ma poprawną konfigurację (JUDGE_PROVIDER, JUDGE_MODEL i klucz). Zwraca tylko tak lub nie, bez żadnych wartości. */
export function isJudgeConfigured(env: Record<string, string | undefined> = process.env): boolean {
  try {
    loadModelConfig(env, "judge");
    return true;
  } catch {
    return false;
  }
}

/** Przycisk i akcja „Oceń sędzią” działają tylko przy JUDGE_UI_ENABLED=true i skonfigurowanym sędzim. */
export function isJudgeUiEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.JUDGE_UI_ENABLED?.trim() === "true" && isJudgeConfigured(env);
}
