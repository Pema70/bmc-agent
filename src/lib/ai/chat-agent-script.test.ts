import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getVariantForProject: vi.fn(),
  getVariantMeta: vi.fn(),
  getProject: vi.fn(),
  checkUserLimits: vi.fn(),
  getChatModel: vi.fn(),
  listChatMessages: vi.fn(),
  saveChatMessage: vi.fn(),
  listAttachmentsForProject: vi.fn(),
  loadAttachmentLimits: vi.fn(),
}));

vi.mock("@/lib/db/variants", () => ({
  getVariantForProject: mocks.getVariantForProject,
  getVariantMeta: mocks.getVariantMeta,
}));
vi.mock("@/lib/db/projects", () => ({ getProject: mocks.getProject }));
vi.mock("@/lib/ai/limits", () => ({ checkUserLimits: mocks.checkUserLimits }));
vi.mock("@/lib/ai/models", () => ({ getChatModel: mocks.getChatModel }));
vi.mock("@/lib/ai/log", () => ({ logLlmCall: vi.fn() }));
vi.mock("@/lib/ai/tools", () => ({ createChatTools: vi.fn(() => ({})) }));
vi.mock("@/lib/attachments/config", () => ({ loadAttachmentLimits: mocks.loadAttachmentLimits }));
vi.mock("@/lib/db/attachments", () => ({ listAttachmentsForProject: mocks.listAttachmentsForProject }));
vi.mock("@/lib/db/chat", () => ({
  listChatMessages: mocks.listChatMessages,
  saveChatMessage: mocks.saveChatMessage,
  newChatMessageId: () => "msg-test",
}));

import { prepareChatTurn } from "@/lib/ai/chat-agent";
import { prepareChatTurnWithoutUserLimits } from "@/lib/ai/chat-agent-script";
import type { AiLimits } from "@/lib/ai/config";
import { emptyBmcState } from "@/lib/schemas/bmc";

const limits = { historyLimit: 20 } as unknown as AiLimits;
const input = { projectId: "p1", userId: "u1", variantId: "v1", message: "Cześć", limits };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getVariantForProject.mockResolvedValue({ id: "v1", version: 1, state: emptyBmcState() });
  mocks.getVariantMeta.mockResolvedValue({ id: "v1", isMain: true });
  mocks.checkUserLimits.mockResolvedValue({ ok: false, message: "Za dużo.", retryAfterSec: 60 });
  mocks.getChatModel.mockReturnValue({ model: {}, provider: "google", modelId: "gemini-3.5-flash-lite" });
  mocks.getProject.mockResolvedValue({ id: "p1", name: "EV-X-BUILD-01-p1", description: "Nowy model biznesowy." });
  mocks.listChatMessages.mockResolvedValue([]);
  mocks.listAttachmentsForProject.mockResolvedValue([]);
  mocks.loadAttachmentLimits.mockReturnValue({ readMaxChars: 8000 });
  mocks.saveChatMessage.mockResolvedValue(undefined);
});

describe("prepareChatTurnWithoutUserLimits (skrypt ewaluacji)", () => {
  it("nie sprawdza limitów użytkownika, a resztę kroków robi tak samo (zapis wiadomości użytkownika, tura)", async () => {
    const result = await prepareChatTurnWithoutUserLimits(input);

    expect(result.ok).toBe(true);
    expect(mocks.checkUserLimits).not.toHaveBeenCalled();
    expect(mocks.saveChatMessage).toHaveBeenCalledTimes(1);
    if (result.ok) {
      expect(result.turn.messages.at(-1)).toMatchObject({ role: "user", parts: [{ type: "text", text: "Cześć" }] });
    }
  });

  it("zachowuje pozostałe odmowy: brak wariantu, wariant poboczny i błąd konfiguracji modelu", async () => {
    mocks.getVariantForProject.mockResolvedValueOnce(null);
    expect(await prepareChatTurnWithoutUserLimits(input)).toMatchObject({ ok: false, status: 404 });

    mocks.getVariantMeta.mockResolvedValueOnce({ id: "v1", isMain: false });
    expect(await prepareChatTurnWithoutUserLimits(input)).toMatchObject({ ok: false, status: 409 });

    mocks.getChatModel.mockImplementationOnce(() => {
      throw new Error("brak klucza");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await prepareChatTurnWithoutUserLimits(input)).toMatchObject({ ok: false, status: 503, error: "CONFIG" });
    expect(mocks.saveChatMessage).not.toHaveBeenCalled();
  });

  it("zwykłe prepareChatTurn przy tych samych danych odmawia (429) i niczego nie zapisuje", async () => {
    const result = await prepareChatTurn(input);

    expect(result).toMatchObject({ ok: false, status: 429, error: "LIMIT", headers: { "Retry-After": "60" } });
    expect(mocks.saveChatMessage).not.toHaveBeenCalled();
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("trasy HTTP nie mogą omijać limitów użytkownika", () => {
  it("żaden plik w src/app nie odwołuje się do chat-agent-script ani prepareChatTurnCore", () => {
    const offenders = sourceFiles(join(process.cwd(), "src", "app")).filter((file) =>
      /chat-agent-script|prepareChatTurnCore|prepareChatTurnWithoutUserLimits|script-limits/.test(readFileSync(file, "utf-8")),
    );
    expect(offenders).toEqual([]);
  });

  it("trasa czatu używa prepareChatTurn", () => {
    const route = readFileSync(join(process.cwd(), "src", "app", "api", "chat", "route.ts"), "utf-8");
    expect(route).toMatch(/\bprepareChatTurn\b/);
  });
});
