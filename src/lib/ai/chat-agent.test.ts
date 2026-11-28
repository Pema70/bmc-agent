import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getVariantForProject: vi.fn(),
  getVariantMeta: vi.fn(),
  getProject: vi.fn(),
  checkUserLimits: vi.fn(),
  getChatModel: vi.fn(),
  listChatMessages: vi.fn(),
  saveChatMessage: vi.fn(),
  logLlmCall: vi.fn(),
  listAttachmentsForProject: vi.fn(),
  loadAttachmentLimits: vi.fn(),
  createChatTools: vi.fn(),
  streamText: vi.fn(),
  toUIMessageStream: vi.fn(),
}));

vi.mock("@/lib/db/variants", () => ({
  getVariantForProject: mocks.getVariantForProject,
  getVariantMeta: mocks.getVariantMeta,
}));
vi.mock("@/lib/db/projects", () => ({ getProject: mocks.getProject }));
vi.mock("@/lib/ai/limits", () => ({ checkUserLimits: mocks.checkUserLimits }));
vi.mock("@/lib/ai/models", () => ({ getChatModel: mocks.getChatModel }));
vi.mock("@/lib/ai/log", () => ({ logLlmCall: mocks.logLlmCall }));
vi.mock("@/lib/ai/tools", () => ({ createChatTools: mocks.createChatTools }));
vi.mock("@/lib/attachments/config", () => ({ loadAttachmentLimits: mocks.loadAttachmentLimits }));
vi.mock("@/lib/db/attachments", () => ({ listAttachmentsForProject: mocks.listAttachmentsForProject }));
vi.mock("@/lib/db/chat", () => {
  let counter = 0;
  return {
    listChatMessages: mocks.listChatMessages,
    saveChatMessage: mocks.saveChatMessage,
    newChatMessageId: () => `msg-test-${++counter}`,
  };
});
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  mocks.streamText.mockImplementation(actual.streamText);
  mocks.toUIMessageStream.mockImplementation(actual.toUIMessageStream);
  return { ...actual, streamText: mocks.streamText, toUIMessageStream: mocks.toUIMessageStream };
});

import { prepareChatTurn, runChatTurn, type ChatTurn } from "@/lib/ai/chat-agent";
import { TRUNCATION_ERROR_CODE } from "@/lib/ai/truncation";
import { emptyBmcState } from "@/lib/schemas/bmc";

const state = { ...emptyBmcState(), channels: ["Sklep online"] };
const limits = {
  maxMessageChars: 2000,
  maxOutputTokens: 2000,
  maxSteps: 3,
  maxPendingProposals: 10,
  historyLimit: 20,
} as unknown as ChatTurn["limits"];

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

function modelWith(text: string, finish: "stop" | "length" = "stop") {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: text },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: finish, raw: undefined }, logprobs: undefined, usage },
        ],
      }),
    }),
  });
}

function mockModel(model: MockLanguageModelV4) {
  mocks.getChatModel.mockReturnValue({ model, provider: "google", modelId: "gemini-3.5-flash-lite" });
  return model;
}

function makeTurn(overrides: Partial<ChatTurn> = {}): ChatTurn {
  return {
    projectId: "p1",
    userId: "u1",
    variant: { id: "v1", version: 3, state },
    project: { name: "Kawiarnia", description: "Opis" },
    limits,
    resolved: mocks.getChatModel("chat"),
    attachmentList: [],
    attachmentReadMaxChars: 8000,
    messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Chcę otworzyć kawiarnię" }] }],
    assistantId: "msg-assistant-1" as ChatTurn["assistantId"],
    startedAt: Date.now(),
    ...overrides,
  };
}

async function drain(stream: ReadableStream): Promise<void> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done } = await reader.read();
      if (done) return;
    }
  } catch {
    // Strumień z błędem też jest „odczytany do końca”.
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getVariantForProject.mockResolvedValue({ id: "v1", version: 3, state });
  mocks.getVariantMeta.mockResolvedValue({ id: "v1", isMain: true });
  mocks.checkUserLimits.mockResolvedValue({ ok: true });
  mocks.getProject.mockResolvedValue({ id: "p1", name: "Kawiarnia", description: "Opis" });
  mocks.listChatMessages.mockResolvedValue([]);
  mocks.listAttachmentsForProject.mockResolvedValue([]);
  mocks.loadAttachmentLimits.mockReturnValue({ readMaxChars: 8000 });
  mocks.saveChatMessage.mockResolvedValue(undefined);
  mocks.logLlmCall.mockResolvedValue(undefined);
  mocks.createChatTools.mockReturnValue({});
  mocks.getChatModel.mockReturnValue({ model: modelWith("Cześć"), provider: "google", modelId: "gemini-3.5-flash-lite" });
});

const input = { projectId: "p1", userId: "u1", variantId: "v1", message: "Chcę otworzyć kawiarnię", limits };

describe("prepareChatTurn", () => {
  it("zwraca turę i zapisuje wiadomość użytkownika dokładnie raz, po odczytach", async () => {
    const order: string[] = [];
    mocks.getVariantForProject.mockImplementation(async () => (order.push("wariant"), { id: "v1", version: 3, state }));
    mocks.checkUserLimits.mockImplementation(async () => (order.push("limity"), { ok: true }));
    mocks.getProject.mockImplementation(async () => (order.push("projekt"), { id: "p1", name: "Kawiarnia", description: "Opis" }));
    mocks.saveChatMessage.mockImplementation(async () => void order.push("zapis"));

    const result = await prepareChatTurn(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(order).toEqual(["wariant", "limity", "projekt", "zapis"]);
    expect(result.turn.messages).toHaveLength(1);
    expect(result.turn.messages[0]).toMatchObject({ role: "user", parts: [{ type: "text", text: "Chcę otworzyć kawiarnię" }] });
    expect(result.turn.attachmentReadMaxChars).toBe(8000);
    expect(mocks.saveChatMessage).toHaveBeenCalledTimes(1);
  });

  it("limity użytkownika są zawsze egzekwowane: brak pola pominięcia w typie, a dodatkowe pole podane mimo to niczego nie omija", async () => {
    mocks.checkUserLimits.mockResolvedValue({ ok: false, message: "Za dużo żądań.", retryAfterSec: 60 });
    // @ts-expect-error `prepareChatTurn` nie przyjmuje opcji pominięcia limitów (tylko skrypt przez chat-agent-script.ts).
    const result = await prepareChatTurn({ ...input, enforceUserLimits: false, skipUserLimits: true });
    expect(result).toMatchObject({ ok: false, status: 429, error: "LIMIT" });
    expect(mocks.checkUserLimits).toHaveBeenCalledTimes(1);
    expect(mocks.saveChatMessage).not.toHaveBeenCalled();
  });

  it("nie ma wariantu: 404 bez limitów i bez zapisu", async () => {
    mocks.getVariantForProject.mockResolvedValue(null);
    const result = await prepareChatTurn(input);
    expect(result).toMatchObject({ ok: false, status: 404, error: "NOT_FOUND" });
    expect(mocks.checkUserLimits).not.toHaveBeenCalled();
    expect(mocks.saveChatMessage).not.toHaveBeenCalled();
  });

  it("wariant nie jest główny: 409 przed limitami i bez zapisu", async () => {
    mocks.getVariantMeta.mockResolvedValue({ id: "v1", isMain: false });
    const result = await prepareChatTurn(input);
    expect(result).toMatchObject({ ok: false, status: 409, error: "VARIANT_NOT_MAIN" });
    expect(mocks.checkUserLimits).not.toHaveBeenCalled();
    expect(mocks.saveChatMessage).not.toHaveBeenCalled();
  });

  it("limit użytkownika: 429 z Retry-After i bez zapisu", async () => {
    mocks.checkUserLimits.mockResolvedValue({ ok: false, message: "Za dużo żądań.", retryAfterSec: 120 });
    const result = await prepareChatTurn(input);
    expect(result).toMatchObject({ ok: false, status: 429, error: "LIMIT", message: "Za dużo żądań.", headers: { "Retry-After": "120" } });
    expect(mocks.getChatModel).not.toHaveBeenCalled();
    expect(mocks.saveChatMessage).not.toHaveBeenCalled();
  });

  it("błąd konfiguracji modelu: 503 bez zapisu osieroconej wiadomości", async () => {
    mocks.getChatModel.mockImplementation(() => {
      throw new Error("brak klucza");
    });
    const result = await prepareChatTurn(input);
    expect(result).toMatchObject({ ok: false, status: 503, error: "CONFIG" });
    expect(mocks.saveChatMessage).not.toHaveBeenCalled();
  });

  it("brak projektu: 404 bez zapisu", async () => {
    mocks.getProject.mockResolvedValue(null);
    const result = await prepareChatTurn(input);
    expect(result).toMatchObject({ ok: false, status: 404, error: "NOT_FOUND" });
    expect(mocks.saveChatMessage).not.toHaveBeenCalled();
  });

  it("błąd konfiguracji załączników: 500 bez zapisu", async () => {
    mocks.loadAttachmentLimits.mockImplementation(() => {
      throw new Error("zła konfiguracja");
    });
    const result = await prepareChatTurn(input);
    expect(result).toMatchObject({ ok: false, status: 500, error: "CONFIG" });
    expect(mocks.saveChatMessage).not.toHaveBeenCalled();
  });
});

describe("runChatTurn: finished rozwiązuje się w każdej ścieżce", () => {
  it("odpowiedź ukończona: zapis asystenta, log OK, status completed (zdarzenie onEnd, outcome completed)", async () => {
    mockModel(modelWith("Cześć! Opowiedz o swoim pomyśle."));
    const { stream, finished } = await runChatTurn(makeTurn());
    await drain(stream);

    await expect(finished).resolves.toEqual({ status: "completed" });
    expect(mocks.saveChatMessage).toHaveBeenCalledWith(expect.objectContaining({ role: "assistant", userId: null }));
    expect(mocks.logLlmCall).toHaveBeenCalledTimes(1);
    expect(mocks.logLlmCall).toHaveBeenCalledWith(expect.objectContaining({ operation: "chat", status: "OK", stepCount: 1 }));
  });

  it("ucięcie limitem długości: znacznik zapisany, log SCHEMA_ERROR/TRUNCATED, status truncated", async () => {
    mockModel(modelWith("Początek odpowiedzi", "length"));
    const { stream, finished } = await runChatTurn(makeTurn());
    await drain(stream);

    await expect(finished).resolves.toEqual({ status: "truncated" });
    expect(mocks.saveChatMessage).toHaveBeenCalledWith(expect.objectContaining({ role: "assistant" }));
    expect(mocks.logLlmCall).toHaveBeenCalledWith(expect.objectContaining({ status: "SCHEMA_ERROR", errorCode: TRUNCATION_ERROR_CODE }));
  });

  it("błąd dostawcy przed pierwszym tokenem: finished = failed, log błędu, brak zapisu asystenta", async () => {
    mockModel(
      new MockLanguageModelV4({
        doStream: async () => {
          throw new APICallError({ message: "Bad request", url: "https://example.test", requestBodyValues: {}, statusCode: 400, isRetryable: false });
        },
      }),
    );
    const { stream, finished } = await runChatTurn(makeTurn());
    await drain(stream);

    await expect(finished).resolves.toEqual({ status: "failed", errorCode: "400" });
    expect(mocks.saveChatMessage).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).toHaveBeenCalledTimes(1);
    expect(mocks.logLlmCall).toHaveBeenCalledWith(expect.objectContaining({ operation: "chat", status: expect.not.stringMatching(/^OK$/) }));
  });

  it("przerwanie przed startem strumienia (sygnał już przerwany): finished = aborted, log ABORTED", async () => {
    mockModel(modelWith("Nie powinno być widoczne"));
    const controller = new AbortController();
    controller.abort();
    const { stream, finished } = await runChatTurn(makeTurn(), { signal: controller.signal });
    await drain(stream);

    await expect(finished).resolves.toEqual({ status: "aborted" });
    expect(mocks.saveChatMessage).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).toHaveBeenCalledTimes(1);
    expect(mocks.logLlmCall).toHaveBeenCalledWith(expect.objectContaining({ operation: "chat", status: "ERROR" }));
  });

  it("przerwanie w trakcie odpowiedzi: finished = aborted, log ABORTED, wiadomość asystenta nie jest zapisywana", async () => {
    const controller = new AbortController();
    mockModel(
      new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream({
            start(streamController) {
              streamController.enqueue({ type: "text-start", id: "t1" });
              streamController.enqueue({ type: "text-delta", id: "t1", delta: "Zaczynam" });
              controller.signal.addEventListener("abort", () => streamController.error(new DOMException("Przerwano", "AbortError")));
            },
          }),
        }),
      }),
    );
    const { stream, finished } = await runChatTurn(makeTurn(), { signal: controller.signal });
    const reading = drain(stream);
    controller.abort();
    await reading;

    await expect(finished).resolves.toEqual({ status: "aborted" });
    expect(mocks.saveChatMessage).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).toHaveBeenCalledWith(expect.objectContaining({ operation: "chat", status: "ERROR" }));
  });

  it("odbiorca anuluje strumień przed końcem: onEnd z outcome aborted rozwiązuje finished, bez zapisu odpowiedzi", async () => {
    mockModel(modelWith("Długa odpowiedź"));
    const { stream, finished } = await runChatTurn(makeTurn());
    await stream.cancel();

    await expect(finished).resolves.toEqual({ status: "aborted" });
    expect(mocks.saveChatMessage).not.toHaveBeenCalled();
  });

  it("strumień zepsuty w połowie (zerwane połączenie): onEnd z outcome failed rozwiązuje finished", async () => {
    mockModel(
      new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream({
            start(streamController) {
              streamController.enqueue({ type: "text-start", id: "t1" });
              streamController.error(new Error("zerwane połączenie"));
            },
          }),
        }),
      }),
    );
    const { stream, finished } = await runChatTurn(makeTurn());
    await drain(stream);

    await expect(finished).resolves.toEqual({ status: "failed", errorCode: "Error" });
  });

  it("wyjątek w obsłudze zakończenia (log się wywraca): finished = failed END_HANDLER, a nie zawieszenie", async () => {
    mockModel(modelWith("Cześć"));
    mocks.logLlmCall.mockRejectedValue(new Error("baza niedostępna"));
    const { stream, finished } = await runChatTurn(makeTurn());
    await drain(stream);

    await expect(finished).resolves.toEqual({ status: "failed", errorCode: "END_HANDLER" });
  });

  it("zapis odpowiedzi się nie udaje: finished = save_failed, log SAVE_FAILED", async () => {
    mockModel(modelWith("Cześć"));
    mocks.saveChatMessage.mockRejectedValue(new Error("baza niedostępna"));
    const { stream, finished } = await runChatTurn(makeTurn());
    await drain(stream);

    await expect(finished).resolves.toEqual({ status: "save_failed" });
    expect(mocks.logLlmCall).toHaveBeenCalledWith(expect.objectContaining({ status: "ERROR", errorCode: "SAVE_FAILED" }));
  });

  it("wyjątek w createChatTools: runChatTurn odrzuca Promise, model nie jest wywoływany, nic nie jest logowane", async () => {
    const model = mockModel(modelWith("Cześć"));
    mocks.createChatTools.mockImplementation(() => {
      throw new Error("błąd narzędzi");
    });

    await expect(runChatTurn(makeTurn())).rejects.toThrow("błąd narzędzi");
    expect(mocks.streamText).not.toHaveBeenCalled();
    expect(model.doStreamCalls).toHaveLength(0);
    expect(mocks.logLlmCall).not.toHaveBeenCalled();
  });

  it("wyjątek w streamText: runChatTurn odrzuca Promise i nic nie jest zapisywane ani logowane", async () => {
    mockModel(modelWith("Cześć"));
    mocks.streamText.mockImplementationOnce(() => {
      throw new Error("błąd streamText");
    });

    await expect(runChatTurn(makeTurn())).rejects.toThrow("błąd streamText");
    expect(mocks.saveChatMessage).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).not.toHaveBeenCalled();
  });

  describe("siatka bezpieczeństwa no_end (strumień UI bez wywołania onEnd)", () => {
    // Podmieniony toUIMessageStream (tylko w teście) zwraca strumień, który nigdy nie woła onEnd, więc `finished` może
    // się rozwiązać wyłącznie przez siatkę w `runChatTurn`.
    function withFakeUiStream(build: (controller: ReadableStreamDefaultController) => void) {
      mocks.toUIMessageStream.mockImplementationOnce(
        () => new ReadableStream({ start: build }) as unknown as ReturnType<typeof import("ai").toUIMessageStream>,
      );
      mockModel(modelWith("Cześć"));
    }

    it("strumień zamyka się bez onEnd: finished = no_end, bez zapisu i bez logu", async () => {
      withFakeUiStream((controller) => {
        controller.enqueue({ type: "start" });
        controller.close();
      });
      const { stream, finished } = await runChatTurn(makeTurn());
      await drain(stream);

      await expect(finished).resolves.toEqual({ status: "no_end" });
      expect(mocks.saveChatMessage).not.toHaveBeenCalled();
      expect(mocks.logLlmCall).not.toHaveBeenCalled();
    });

    it("strumień psuje się bez onEnd: finished = no_end, a odbiorca dostaje ten sam błąd", async () => {
      withFakeUiStream((controller) => {
        controller.enqueue({ type: "start" });
        controller.error(new Error("zerwane"));
      });
      const { stream, finished } = await runChatTurn(makeTurn());
      const reader = stream.getReader();
      await expect((async () => { for (;;) { if ((await reader.read()).done) return; } })()).rejects.toThrow("zerwane");

      await expect(finished).resolves.toEqual({ status: "no_end" });
      expect(mocks.logLlmCall).not.toHaveBeenCalled();
    });

    it("odbiorca anuluje strumień bez onEnd: finished = no_end, a anulowanie dociera do strumienia wewnętrznego", async () => {
      const cancelled = vi.fn();
      mocks.toUIMessageStream.mockImplementationOnce(
        () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "start" });
            },
            cancel: cancelled,
          }) as unknown as ReturnType<typeof import("ai").toUIMessageStream>,
      );
      mockModel(modelWith("Cześć"));
      const { stream, finished } = await runChatTurn(makeTurn());
      await stream.cancel("zamknięta karta");

      await expect(finished).resolves.toEqual({ status: "no_end" });
      expect(cancelled).toHaveBeenCalledWith("zamknięta karta");
      expect(mocks.logLlmCall).not.toHaveBeenCalled();
    });
  });
});
