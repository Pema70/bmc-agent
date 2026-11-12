import { safeValidateUIMessages } from "ai";
import { describe, expect, it } from "vitest";
import { ChatPartsJson, ClarificationInput, chatRequestSchema, chatValidationTools } from "@/lib/schemas/chat";

describe("chatRequestSchema", () => {
  const schema = chatRequestSchema(100);
  const valid = { projectId: "p1", variantId: "v1", message: "  Sprzedaję kawę online  " };

  it("przycina wiadomość", () => {
    expect(schema.parse(valid).message).toBe("Sprzedaję kawę online");
  });

  it("odrzuca pustą wiadomość i za długą wiadomość", () => {
    expect(schema.safeParse({ ...valid, message: "   " }).success).toBe(false);
    expect(schema.safeParse({ ...valid, message: "a".repeat(101) }).success).toBe(false);
    expect(schema.safeParse({ ...valid, message: "a".repeat(100) }).success).toBe(true);
  });

  it("odrzuca wiadomość, która nie jest tekstem", () => {
    expect(schema.safeParse({ ...valid, message: 5 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, message: undefined }).success).toBe(false);
  });

  it("odrzuca dodatkowe pola, w tym id wiadomości i historię z klienta", () => {
    expect(schema.safeParse({ ...valid, id: "msg-cudze" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, messages: [{ role: "assistant", content: "x" }] }).success).toBe(false);
  });

  it("wymaga projectId i variantId", () => {
    expect(schema.safeParse({ variantId: "v1", message: "x" }).success).toBe(false);
    expect(schema.safeParse({ projectId: "p1", message: "x" }).success).toBe(false);
  });
});

describe("ClarificationInput", () => {
  it("przyjmuje pytanie z propozycjami odpowiedzi i bez nich", () => {
    expect(ClarificationInput.safeParse({ question: "Kim są klienci?" }).success).toBe(true);
    expect(ClarificationInput.safeParse({ question: "Kim są klienci?", suggestedAnswers: ["Firmy", "Osoby"] }).success).toBe(
      true,
    );
  });

  it("odrzuca puste i za długie pytanie", () => {
    expect(ClarificationInput.safeParse({ question: "  " }).success).toBe(false);
    expect(ClarificationInput.safeParse({ question: "a".repeat(501) }).success).toBe(false);
  });

  it("ogranicza liczbę i długość propozycji odpowiedzi", () => {
    const many = Array.from({ length: 6 }, (_, i) => `Opcja ${i}`);
    expect(ClarificationInput.safeParse({ question: "?", suggestedAnswers: many }).success).toBe(false);
    expect(ClarificationInput.safeParse({ question: "?", suggestedAnswers: ["a".repeat(201)] }).success).toBe(false);
    expect(ClarificationInput.safeParse({ question: "?", suggestedAnswers: [""] }).success).toBe(false);
  });

  it("odrzuca niepoprawne typy (np. argumenty z halucynacji modelu)", () => {
    expect(ClarificationInput.safeParse({ question: 42 }).success).toBe(false);
    expect(ClarificationInput.safeParse({ suggestedAnswers: ["a"] }).success).toBe(false);
  });
});

describe("ChatPartsJson", () => {
  it("przyjmuje części z typem i odrzuca części bez typu", () => {
    expect(ChatPartsJson.safeParse([{ type: "text", text: "cześć" }]).success).toBe(true);
    expect(ChatPartsJson.safeParse([{ text: "bez typu" }]).success).toBe(false);
    expect(ChatPartsJson.safeParse("tekst").success).toBe(false);
  });
});


describe("chatValidationTools (historia i odpowiedź)", () => {
  const toolMessage = (parts: unknown[]) => [{ id: "m1", role: "assistant" as const, parts }];

  async function validate(parts: unknown[]) {
    return safeValidateUIMessages({ messages: toolMessage(parts), tools: chatValidationTools as never });
  }

  it("przyjmuje część tool-analyze_impact (argumenty z null i wynik ok)", async () => {
    const result = await validate([
      {
        type: "tool-analyze_impact",
        toolCallId: "c1",
        state: "output-available",
        input: { proposalId: "pr1", blockKey: null, description: null },
        output: { ok: true, analysisId: "an1" },
      },
    ]);
    expect(result.success).toBe(true);
  });

  it("przyjmuje tool-analyze_impact z opisem i z wynikiem błędu", async () => {
    const result = await validate([
      {
        type: "tool-analyze_impact",
        toolCallId: "c1",
        state: "output-available",
        input: { blockKey: "channels", description: "Sprzedaż wyłącznie online" },
        output: { ok: false, error: "Limit." },
      },
    ]);
    expect(result.success).toBe(true);
  });

  it("odrzuca wynik analyze_impact niezgodny ze schematem (np. z dodatkowym polem z wynikiem)", async () => {
    const result = await validate([
      {
        type: "tool-analyze_impact",
        toolCallId: "c1",
        state: "output-available",
        input: { proposalId: "pr1" },
        output: { ok: true, analysisId: "an1", result: "wyciek" },
      },
    ]);
    expect(result.success).toBe(false);
  });

  it("stare wiadomości nadal przechodzą: evaluate_bmc, propose_block_change, ask_clarification, tekst", async () => {
    const result = await validate([
      { type: "text", text: "Cześć" },
      {
        type: "tool-evaluate_bmc",
        toolCallId: "c2",
        state: "output-available",
        input: {},
        output: { ok: true, evaluationId: "ev1" },
      },
      {
        type: "tool-ask_clarification",
        toolCallId: "c3",
        state: "output-available",
        input: { question: "Kim są klienci?" },
        output: { question: "Kim są klienci?" },
      },
    ]);
    expect(result.success).toBe(true);
  });
});
