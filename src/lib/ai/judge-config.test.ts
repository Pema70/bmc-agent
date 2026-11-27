import { describe, expect, it } from "vitest";
import { isJudgeConfigured, isJudgeUiEnabled } from "@/lib/ai/judge-config";

const judgeEnv = { JUDGE_PROVIDER: "anthropic", JUDGE_MODEL: "claude-haiku-5-5", ANTHROPIC_API_KEY: "klucz" };

describe("isJudgeConfigured", () => {
  it("tak tylko przy poprawnych JUDGE_PROVIDER, JUDGE_MODEL i kluczu", () => {
    expect(isJudgeConfigured(judgeEnv)).toBe(true);
    expect(isJudgeConfigured({})).toBe(false);
    expect(isJudgeConfigured({ ...judgeEnv, ANTHROPIC_API_KEY: "" })).toBe(false);
    expect(isJudgeConfigured({ ...judgeEnv, JUDGE_MODEL: " " })).toBe(false);
    expect(isJudgeConfigured({ ...judgeEnv, JUDGE_PROVIDER: "google" })).toBe(false);
  });

  it("konfiguracja czatu (LLM_*) nie wystarcza", () => {
    expect(
      isJudgeConfigured({ LLM_PROVIDER: "google", LLM_MODEL: "gemini-3.8-flash", GOOGLE_GENERATIVE_AI_API_KEY: "k" }),
    ).toBe(false);
  });
});

describe("isJudgeUiEnabled", () => {
  it("wymaga flagi JUDGE_UI_ENABLED=true i skonfigurowanego sędziego", () => {
    expect(isJudgeUiEnabled({ ...judgeEnv, JUDGE_UI_ENABLED: "true" })).toBe(true);
    expect(isJudgeUiEnabled({ ...judgeEnv, JUDGE_UI_ENABLED: " true " })).toBe(true);
  });

  it("bez flagi, z inną wartością lub bez konfiguracji przycisk jest wyłączony", () => {
    expect(isJudgeUiEnabled(judgeEnv)).toBe(false);
    expect(isJudgeUiEnabled({ ...judgeEnv, JUDGE_UI_ENABLED: "" })).toBe(false);
    expect(isJudgeUiEnabled({ ...judgeEnv, JUDGE_UI_ENABLED: "1" })).toBe(false);
    expect(isJudgeUiEnabled({ ...judgeEnv, JUDGE_UI_ENABLED: "TRUE" })).toBe(false);
    expect(isJudgeUiEnabled({ JUDGE_UI_ENABLED: "true" })).toBe(false);
  });
});
