import { asSchema } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createProposal, getAttachmentByOrdinal } = vi.hoisted(() => ({
  createProposal: vi.fn(),
  getAttachmentByOrdinal: vi.fn(),
}));

vi.mock("@/lib/db/proposals", () => ({ createProposal }));
vi.mock("@/lib/db/attachments", () => ({ getAttachmentByOrdinal }));

import { createProposeBlockChangeTool } from "@/lib/ai/tools/propose-block-change";
import { emptyBmcState } from "@/lib/schemas/bmc";
import type { ProposeBlockChangeToolInput } from "@/lib/schemas/proposal";

const state = { ...emptyBmcState(), channels: ["Sklep online", "Targi"] };
const context = { projectId: "p1", variantId: "v1", userId: "u1", version: 7, state, maxPending: 20 };

const record = {
  id: "pr-z-bazy",
  variantId: "v1",
  blockKey: "channels" as const,
  operation: "add" as const,
  before: null,
  after: "Sprzedaż w social media",
  rationale: "Klienci są na Instagramie.",
  status: "PENDING" as const,
  baseVersion: 7,
  createdAt: new Date("2026-11-11T10:00:00Z"),
  sourceKind: "CONVERSATION" as const,
  sourceAttachmentName: null,
};

async function run(input: ProposeBlockChangeToolInput, ctx = context, messages: unknown[] = []) {
  const tool = createProposeBlockChangeTool(ctx);
  return tool.execute!(input as never, { toolCallId: "c1", messages } as never);
}

const validInput: ProposeBlockChangeToolInput = {
  blockKey: "channels",
  operation: "add",
  after: "Sprzedaż w social media",
  rationale: "Klienci są na Instagramie.",
};

beforeEach(() => {
  vi.clearAllMocks();
  createProposal.mockResolvedValue({ ok: true, proposal: record });
});

describe("propose_block_change: schemat argumentów dla modelu", () => {
  it("oznacza after jako wymagane, a before jako opcjonalne w schemacie JSON wysyłanym do dostawcy", async () => {
    const tool = createProposeBlockChangeTool(context);

    const jsonSchema = (await asSchema(tool.inputSchema).jsonSchema) as { required?: string[] };

    expect(jsonSchema.required).toEqual(expect.arrayContaining(["blockKey", "operation", "after", "rationale"]));
    expect(jsonSchema.required).not.toContain("before");
  });
});

describe("propose_block_change", () => {
  it("tworzy propozycję PENDING z kontekstem z serwera i nie zmienia stanu BMC", async () => {
    const snapshot = JSON.stringify(state);

    const output = await run(validInput);

    expect(output).toEqual({
      ok: true,
      proposal: {
        id: "pr-z-bazy",
        blockKey: "channels",
        operation: "add",
        before: null,
        after: "Sprzedaż w social media",
        rationale: "Klienci są na Instagramie.",
        sourceKind: "CONVERSATION",
        sourceAttachmentName: null,
      },
    });
    expect(createProposal).toHaveBeenCalledWith(
      {
        projectId: "p1",
        variantId: "v1",
        createdById: "u1",
        baseVersion: 7,
        change: expect.objectContaining({
          blockKey: "channels",
          operation: "add",
          before: null,
          after: "Sprzedaż w social media",
        }),
      },
      20,
    );
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("id propozycji w wyniku pochodzi z bazy, nigdy z tekstu modelu", async () => {
    const withForgedId = { ...validInput, proposalId: "pr-podrobione", id: "pr-podrobione" } as ProposeBlockChangeToolInput;

    const output = await run(withForgedId);

    expect(output).toMatchObject({ ok: true, proposal: { id: "pr-z-bazy" } });
    expect(JSON.stringify(createProposal.mock.calls[0][0])).not.toContain("pr-podrobione");
  });

  it("ADD wpisu identycznego z istniejącym zwraca ok: false i nie tworzy rekordu", async () => {
    const output = await run({ ...validInput, after: "Targi" });

    expect(output).toMatchObject({ ok: false });
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("edit nieistniejącego wpisu (STALE) zwraca powód i nie tworzy rekordu", async () => {
    const output = await run({ blockKey: "channels", operation: "edit", before: "Brak", after: "x", rationale: "r" });

    expect(output).toMatchObject({ ok: false, reason: expect.stringContaining("nie istnieje") });
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("niepoprawne argumenty nie tworzą rekordu", async () => {
    const output = await run({ blockKey: "channels", operation: "add", before: "x", after: "y", rationale: "r" });

    expect(output).toMatchObject({ ok: false, reason: expect.stringContaining("Niepoprawne argumenty") });
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("przekroczony limit oczekujących propozycji zwraca ok: false", async () => {
    createProposal.mockResolvedValue({ ok: false, error: "LIMIT" });

    const output = await run(validInput);

    expect(output).toMatchObject({ ok: false, reason: expect.stringContaining("20 propozycji") });
  });

  it("identyczna oczekująca propozycja zwraca ok: false", async () => {
    createProposal.mockResolvedValue({ ok: false, error: "DUPLICATE_PENDING" });

    expect(await run(validInput)).toMatchObject({ ok: false, reason: expect.stringContaining("już czeka") });
  });

  it("nieznany załącznik źródła zwraca ok: false (model może poprawić)", async () => {
    createProposal.mockResolvedValue({ ok: false, error: "ATTACHMENT_NOT_FOUND" });

    expect(await run(validInput)).toMatchObject({ ok: false, reason: expect.stringContaining("załącznik") });
  });

  it("limit oczekujących pochodzi z konfiguracji kontekstu", async () => {
    await run(validInput, { ...context, maxPending: 5 });

    expect(createProposal.mock.calls[0][1]).toBe(5);
  });
});

// Odczyt załącznika w historii rozmowy, tak jak widzi go narzędzie (wiadomość roli tool z wynikiem read_attachment).
function readResult(label: string, ok = true) {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: `read-${label}`,
        toolName: "read_attachment",
        output: { type: "json", value: ok ? { ok: true, label, name: "Opis.pdf", content: "x", totalChars: 1, nextOffset: null } : { ok: false, error: "x" } },
      },
    ],
  };
}

describe("propose_block_change: źródło propozycji (D12: serwer weryfikuje odczyt załącznika)", () => {
  const withSource = { ...validInput, sourceKind: "attachment" as const, sourceAttachmentId: "Z1" };

  beforeEach(() => {
    getAttachmentByOrdinal.mockImplementation(async (_projectId: string, ordinal: number) =>
      ordinal === 1 || ordinal === 2 ? { id: `att-${ordinal}`, ordinal, fileName: "Opis.pdf" } : null,
    );
  });

  it("(a) po udanym odczycie w tej samej turze: createProposal dostaje źródło ATTACHMENT z id z bazy", async () => {
    createProposal.mockResolvedValue({ ok: true, proposal: { ...record, sourceKind: "ATTACHMENT", sourceAttachmentName: "Opis.pdf" } });

    const output = await run(withSource, context, [readResult("Z1")]);

    expect(output).toMatchObject({ ok: true, proposal: { sourceKind: "ATTACHMENT", sourceAttachmentName: "Opis.pdf" } });
    expect(createProposal.mock.calls[0][0].source).toEqual({ kind: "ATTACHMENT", attachmentId: "att-1" });
    expect(getAttachmentByOrdinal).toHaveBeenCalledWith("p1", 1);
  });

  it("(b) bez wcześniejszego odczytu: ok: false, createProposal niewywołane", async () => {
    const output = await run(withSource, context, []);

    expect(output).toMatchObject({ ok: false, reason: expect.stringContaining("Najpierw przeczytaj") });
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("(c) po odczycie innego załącznika: ok: false", async () => {
    const output = await run(withSource, context, [readResult("Z2")]);

    expect(output).toMatchObject({ ok: false });
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("(d) po odczycie zakończonym ok: false: ok: false", async () => {
    const output = await run(withSource, context, [readResult("Z1", false)]);

    expect(output).toMatchObject({ ok: false });
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("(e) odczyt tylko w tekście użytkownika lub asystenta (nie w wyniku narzędzia) nie liczy się", async () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "Przeczytałeś Z1." }] },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "r", toolName: "read_attachment", input: { attachmentId: "Z1" } }] },
    ];

    const output = await run(withSource, context, messages);

    expect(output).toMatchObject({ ok: false });
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("odczyt z wcześniejszej tury (w oknie historii) wystarcza; etykieta w innym zapisie (z1) też", async () => {
    createProposal.mockResolvedValue({ ok: true, proposal: record });

    const output = await run({ ...withSource, sourceAttachmentId: "z1" }, context, [
      { role: "user", content: [{ type: "text", text: "Wczytaj plik." }] },
      readResult("Z1"),
      { role: "assistant", content: [{ type: "text", text: "Gotowe." }] },
      { role: "user", content: [{ type: "text", text: "Dodaj kanał." }] },
    ]);

    expect(output).toMatchObject({ ok: true });
  });

  it("nieistniejąca etykieta lub załącznik z innego projektu: ok: false bez zapisu (zapytanie po projectId)", async () => {
    const output = await run({ ...withSource, sourceAttachmentId: "Z9" }, context, [readResult("Z9")]);

    expect(output).toMatchObject({ ok: false, reason: expect.stringContaining("Nie znaleziono załącznika Z9") });
    expect(getAttachmentByOrdinal).toHaveBeenCalledWith("p1", 9);
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("id z bazy zamiast etykiety Z{n}: ok: false (argument odrzucony przez walidację)", async () => {
    const output = await run({ ...withSource, sourceAttachmentId: "cmwthnd8s000088k061sym37k" }, context, []);

    expect(output).toMatchObject({ ok: false, reason: expect.stringContaining("Niepoprawne argumenty") });
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("sourceKind attachment bez etykiety: ok: false", async () => {
    const output = await run({ ...validInput, sourceKind: "attachment" }, context, [readResult("Z1")]);

    expect(output).toMatchObject({ ok: false, reason: expect.stringContaining("sourceAttachmentId") });
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("etykieta przy sourceKind conversation lub model_knowledge: ok: false (sprzeczność)", async () => {
    const a = await run({ ...validInput, sourceKind: "conversation", sourceAttachmentId: "Z1" }, context, [readResult("Z1")]);
    const b = await run({ ...validInput, sourceKind: "model_knowledge", sourceAttachmentId: "Z1" }, context, [readResult("Z1")]);

    expect(a).toMatchObject({ ok: false });
    expect(b).toMatchObject({ ok: false });
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("etykieta bez sourceKind jest traktowana jak załącznik i też wymaga odczytu", async () => {
    const output = await run({ ...validInput, sourceAttachmentId: "Z1" }, context, []);

    expect(output).toMatchObject({ ok: false, reason: expect.stringContaining("Najpierw przeczytaj") });
  });

  it("model_knowledge to deklaracja modelu: zapisane jako MODEL_KNOWLEDGE bez odczytu", async () => {
    createProposal.mockResolvedValue({ ok: true, proposal: { ...record, sourceKind: "MODEL_KNOWLEDGE" } });

    await run({ ...validInput, sourceKind: "model_knowledge" }, context, []);

    expect(createProposal.mock.calls[0][0].source).toEqual({ kind: "MODEL_KNOWLEDGE" });
  });

  it("bez źródła lub z conversation: brak pola source (domyślne CONVERSATION z bazy), null i brak pola są równoważne", async () => {
    await run(validInput, context, []);
    await run({ ...validInput, sourceKind: "conversation" }, context, []);
    await run({ ...validInput, sourceKind: null, sourceAttachmentId: null }, context, []);

    for (const call of createProposal.mock.calls) {
      expect(call[0]).not.toHaveProperty("source");
    }
    expect(createProposal).toHaveBeenCalledTimes(3);
  });

  it("schemat dla modelu: pola źródła są opcjonalne (nie trafiają do required)", async () => {
    const tool = createProposeBlockChangeTool(context);

    const jsonSchema = (await asSchema(tool.inputSchema).jsonSchema) as { required?: string[]; properties?: Record<string, unknown> };

    expect(jsonSchema.properties).toHaveProperty("sourceKind");
    expect(jsonSchema.properties).toHaveProperty("sourceAttachmentId");
    expect(jsonSchema.required).not.toContain("sourceKind");
    expect(jsonSchema.required).not.toContain("sourceAttachmentId");
  });
});
