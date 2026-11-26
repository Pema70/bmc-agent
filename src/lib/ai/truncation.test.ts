import type { TextStreamPart, ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import { TRUNCATION_NOTICE, dropIncompleteToolParts, withTruncationNotice } from "@/lib/ai/truncation";

type Part = TextStreamPart<ToolSet>;

// Tylko pola, które czyta transformacja; reszta części kroku nie ma tu znaczenia.
const finishStep = (finishReason: string) => ({ type: "finish-step", finishReason }) as unknown as Part;
const start = { type: "start-step" } as unknown as Part;
const text = (id: string, value: string): Part[] => [
  { type: "text-start", id },
  { type: "text-delta", id, text: value },
  { type: "text-end", id },
];

function streamOf(parts: Part[]): ReadableStream<Part> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Part>): Promise<Part[]> {
  const out: Part[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out.push(value);
  }
}

describe("withTruncationNotice", () => {
  it("przepuszcza strumień bez zmian, gdy krok kończy się normalnie", async () => {
    const parts = [start, ...text("t1", "Cześć"), finishStep("stop")];
    const watch = withTruncationNotice(streamOf(parts), "n1");

    expect(await collect(watch.stream)).toEqual(parts);
    expect(watch.wasTruncated()).toBe(false);
  });

  it("przy finishReason = length dopisuje znacznik tuż przed zakończeniem kroku", async () => {
    const watch = withTruncationNotice(streamOf([start, ...text("t1", "Początek"), finishStep("length")]), "n1");

    const out = await collect(watch.stream);

    expect(out.map((part) => part.type)).toEqual([
      "start-step",
      "text-start",
      "text-delta",
      "text-end",
      "text-start",
      "text-delta",
      "text-end",
      "finish-step",
    ]);
    expect(out[5]).toEqual({ type: "text-delta", id: "n1", text: TRUNCATION_NOTICE });
    expect(watch.wasTruncated()).toBe(true);
  });

  it("znacznik trafia do strumienia tylko raz, nawet gdy kilka kroków skończy się length", async () => {
    const watch = withTruncationNotice(streamOf([start, finishStep("length"), start, finishStep("length")]), "n1");

    const out = await collect(watch.stream);

    expect(out.filter((part) => part.type === "text-delta")).toHaveLength(1);
  });

  it("pusty strumień nie jest uznany za ucięty", async () => {
    const watch = withTruncationNotice(streamOf([]), "n1");

    expect(await collect(watch.stream)).toEqual([]);
    expect(watch.wasTruncated()).toBe(false);
  });
});

describe("dropIncompleteToolParts", () => {
  it("zostawia tekst i ukończone narzędzia, usuwa nieukończone", () => {
    const parts = [
      { type: "step-start" },
      { type: "text", text: "x" },
      { type: "tool-propose_block_change", state: "output-available" },
      { type: "tool-evaluate_bmc", state: "output-error" },
      { type: "tool-propose_block_change", state: "input-streaming" },
      { type: "tool-ask_clarification", state: "input-available" },
      { type: "dynamic-tool", state: "input-streaming" },
    ];

    expect(dropIncompleteToolParts(parts).map((part) => `${part.type}:${part.state ?? ""}`)).toEqual([
      "step-start:",
      "text:",
      "tool-propose_block_change:output-available",
      "tool-evaluate_bmc:output-error",
    ]);
  });
});
