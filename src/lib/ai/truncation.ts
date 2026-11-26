import type { TextStreamPart, ToolSet } from "ai";

// Odpowiedź ucięta limitem tokenów wyjścia (finishReason = length). Model z myśleniem potrafi zużyć cały limit
// na tokeny „thinking” i nie zostawić tekstu, a trasa czatu zapisywała taką turę jako udaną (plan kroku 10, punkt 16).

/** Znacznik widoczny w czacie i zapisywany jako treść wiadomości asystenta (zwykły tekst; bez szczegółów dostawcy). */
export const TRUNCATION_NOTICE =
  "[Odpowiedź została ucięta, bo przekroczyła limit długości. Napisz „kontynuuj” albo zadaj krótsze pytanie.]";

/** Wartość LlmCallLog.errorCode (status SCHEMA_ERROR), taka sama jak przy ocenie. */
export const TRUNCATION_ERROR_CODE = "TRUNCATED";

export type TruncationWatch<TOOLS extends ToolSet> = {
  stream: ReadableStream<TextStreamPart<TOOLS>>;
  /** True po przejściu strumienia, jeśli któryś krok skończył się z finishReason = length. */
  wasTruncated: () => boolean;
};

/**
 * Przepuszcza strumień bez zmian, a przy pierwszym kroku zakończonym `length` dopisuje (w tym kroku, tuż przed jego
 * zakończeniem) część tekstową ze znacznikiem. Dzięki temu użytkownik widzi znacznik na żywo, a odpowiedź zbudowana
 * ze strumienia zawiera go samo, więc zapis i widok są takie same.
 */
export function withTruncationNotice<TOOLS extends ToolSet>(
  stream: ReadableStream<TextStreamPart<TOOLS>>,
  noticeId: string,
): TruncationWatch<TOOLS> {
  let truncated = false;
  const transformed = stream.pipeThrough(
    new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(part, controller) {
        if (part.type === "finish-step" && part.finishReason === "length" && !truncated) {
          truncated = true;
          controller.enqueue({ type: "text-start", id: noticeId });
          controller.enqueue({ type: "text-delta", id: noticeId, text: TRUNCATION_NOTICE });
          controller.enqueue({ type: "text-end", id: noticeId });
        }
        controller.enqueue(part);
      },
    }),
  );
  return { stream: transformed, wasTruncated: () => truncated };
}

type PartLike = { type: string; state?: unknown };

/**
 * Zostawia tylko ukończone wywołania narzędzi (z wynikiem lub błędem). Nieukończone (np. argumenty urwane limitem)
 * nie mogą trafić do historii: model dostałby wywołanie bez wyniku i następna tura skończyłaby się błędem dostawcy.
 */
export function dropIncompleteToolParts<T extends PartLike>(parts: readonly T[]): T[] {
  return parts.filter((part) => {
    const isTool = part.type.startsWith("tool-") || part.type === "dynamic-tool";
    return !isTool || (typeof part.state === "string" && part.state.startsWith("output-"));
  });
}
