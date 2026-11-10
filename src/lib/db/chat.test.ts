import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, create, upsert, update } = vi.hoisted(() => ({
  findMany: vi.fn(),
  create: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: { chatMessage: { findMany, create, upsert, update } } }));

import { listChatMessages, newChatMessageId, saveChatMessage } from "@/lib/db/chat";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("newChatMessageId", () => {
  it("generuje unikalne id z prefiksem po stronie serwera", () => {
    const a = newChatMessageId();
    const b = newChatMessageId();

    expect(a).toMatch(/^msg-/);
    expect(a).not.toBe(b);
  });
});

describe("listChatMessages", () => {
  it("filtruje po projectId i zwraca wiadomości od najstarszej do najnowszej", async () => {
    findMany.mockResolvedValue([
      { id: "m2", role: "ASSISTANT", parts: [{ type: "text", text: "Odpowiedź" }] },
      { id: "m1", role: "USER", parts: [{ type: "text", text: "Pytanie" }] },
    ]);

    const messages = await listChatMessages("p1", 30);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "p1" }, take: 30 }));
    expect(messages.map((m) => [m.id, m.role])).toEqual([
      ["m1", "user"],
      ["m2", "assistant"],
    ]);
  });

  it("czyta historię tylko wskazanego projektu, nie innego", async () => {
    findMany.mockResolvedValue([]);

    await listChatMessages("p1", 10);
    await listChatMessages("p2", 10);

    const wheres = findMany.mock.calls.map((call) => call[0].where);
    expect(wheres).toEqual([{ projectId: "p1" }, { projectId: "p2" }]);
  });

  it("dla pustej historii zwraca pustą listę", async () => {
    findMany.mockResolvedValue([]);

    expect(await listChatMessages("p1", 30)).toEqual([]);
  });

  it("rzuca jawny błąd dla uszkodzonej wiadomości zamiast ją pomijać", async () => {
    findMany.mockResolvedValue([{ id: "m1", role: "USER", parts: "to nie są części" }]);

    await expect(listChatMessages("p1", 30)).rejects.toThrow("Niepoprawna historia czatu projektu p1");
  });

  it("odrzuca wynik narzędzia niezgodny ze schematem", async () => {
    findMany.mockResolvedValue([
      {
        id: "m1",
        role: "ASSISTANT",
        parts: [
          {
            type: "tool-ask_clarification",
            toolCallId: "c1",
            state: "output-available",
            input: { question: "?" },
            output: { question: 123 },
          },
        ],
      },
    ]);

    await expect(listChatMessages("p1", 30)).rejects.toThrow("Niepoprawna historia czatu");
  });
});

describe("saveChatMessage", () => {
  const parts = [{ type: "text", text: "Cześć" }];

  it("zapisuje wiadomość przez create z id nadanym przez serwer", async () => {
    create.mockResolvedValue({});
    const id = newChatMessageId();

    await saveChatMessage({ id, projectId: "p1", userId: "u1", role: "user", parts });

    expect(create).toHaveBeenCalledWith({ data: { id, projectId: "p1", userId: "u1", role: "USER", parts } });
  });

  it("zapisuje odpowiedź asystenta bez autora", async () => {
    create.mockResolvedValue({});

    await saveChatMessage({ id: newChatMessageId(), projectId: "p1", userId: null, role: "assistant", parts });

    expect(create.mock.calls[0][0].data).toMatchObject({ role: "ASSISTANT", userId: null });
  });

  it("próba zapisu pod istniejącym (cudzym) id kończy się błędem i niczego nie nadpisuje", async () => {
    create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    const cudzeId = newChatMessageId();

    await expect(
      saveChatMessage({ id: cudzeId, projectId: "p-atakujacego", userId: "u1", role: "user", parts }),
    ).rejects.toThrow("Unique constraint");
    expect(upsert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("nigdy nie używa upsert ani update", async () => {
    create.mockResolvedValue({});

    await saveChatMessage({ id: newChatMessageId(), projectId: "p1", userId: "u1", role: "user", parts });

    expect(upsert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("nie zapisuje części niezgodnych z kształtem", async () => {
    await expect(
      saveChatMessage({ id: newChatMessageId(), projectId: "p1", userId: "u1", role: "user", parts: [{ text: "bez typu" }] }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});
