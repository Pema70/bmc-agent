"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CHAT_MESSAGE_MAX_CHARS, type ChatUIMessage } from "@/lib/schemas/chat";

type AgentChatProps = {
  projectId: string;
  variantId: string;
  initialMessages: ChatUIMessage[];
};

const GENERIC_ERROR = "Nie udało się uzyskać odpowiedzi od agenta. Spróbuj ponownie.";

// Serwer odpowiada JSON-em { error, message }; w innych przypadkach pokazujemy komunikat ogólny.
function errorText(error: Error | undefined): string | null {
  if (!error) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(error.message);
    if (typeof parsed === "object" && parsed !== null && "message" in parsed && typeof parsed.message === "string") {
      return parsed.message;
    }
  } catch {
    // Komunikat nie jest JSON-em (np. błąd sieci albo błąd ze strumienia).
  }
  return error.message && error.message.length <= 300 ? error.message : GENERIC_ERROR;
}

export function AgentChat({ projectId, variantId, initialMessages }: AgentChatProps) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: "/api/chat",
        // Serwer trzyma historię i nadaje id wiadomości (D3): wysyłamy tylko tekst nowej wiadomości.
        prepareSendMessagesRequest: ({ messages }) => {
          const last = messages[messages.length - 1];
          const message = last?.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n") ?? "";
          return { body: { projectId, variantId, message } };
        },
      }),
    [projectId, variantId],
  );

  const { messages, sendMessage, status, error, stop } = useChat<ChatUIMessage>({
    id: `project-${projectId}`,
    messages: initialMessages,
    transport,
  });

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";
  const errorMessage = errorText(error);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) {
      return;
    }
    void sendMessage({ text: trimmed });
    setInput("");
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(input);
    }
  }

  const lastMessageId = messages[messages.length - 1]?.id;

  return (
    <section
      className="flex h-[32rem] flex-col rounded-lg border border-zinc-300 dark:border-zinc-700 xl:h-[40rem]"
      aria-labelledby="chat-heading"
    >
      <h2 id="chat-heading" className="border-b border-zinc-300 px-4 py-3 text-lg font-semibold dark:border-zinc-700">
        Agent BMC
      </h2>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3" aria-live="polite">
        {messages.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Opisz swój pomysł na biznes, a agent dopyta o szczegóły i pomoże uporządkować model.
          </p>
        ) : null}

        {messages.map((message) => (
          <article
            key={message.id}
            className={
              message.role === "user"
                ? "ml-6 rounded-md bg-zinc-100 px-3 py-2 dark:bg-zinc-800"
                : "mr-6 rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700"
            }
          >
            <p className="mb-1 text-xs font-medium text-zinc-500">{message.role === "user" ? "Ty" : "Agent"}</p>
            <div className="flex flex-col gap-2 text-sm">
              {message.parts.map((part, index) => {
                if (part.type === "text") {
                  // Zwykły tekst (węzeł tekstowy React), bez HTML i Markdown.
                  return (
                    <p key={index} className="whitespace-pre-wrap break-words">
                      {part.text}
                    </p>
                  );
                }
                if (part.type === "tool-ask_clarification") {
                  switch (part.state) {
                    case "output-available":
                      return (
                        <div key={index} className="flex flex-col gap-2">
                          <p className="whitespace-pre-wrap break-words font-medium">{part.output.question}</p>
                          {message.id === lastMessageId && !busy && part.output.suggestedAnswers?.length ? (
                            <div className="flex flex-wrap gap-2">
                              {part.output.suggestedAnswers.map((answer) => (
                                <button
                                  key={answer}
                                  type="button"
                                  onClick={() => send(answer)}
                                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                                >
                                  {answer}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    case "output-error":
                      return (
                        <p key={index} className="text-red-700 dark:text-red-400">
                          Agent zadał niepoprawne pytanie. Napisz, co chcesz zrobić dalej.
                        </p>
                      );
                    default:
                      return (
                        <p key={index} className="text-zinc-500">
                          Agent formułuje pytanie…
                        </p>
                      );
                  }
                }
                return null;
              })}
            </div>
          </article>
        ))}

        {status === "submitted" ? <p className="text-sm text-zinc-500">Agent pisze…</p> : null}
        {errorMessage ? (
          <p role="alert" className="rounded-md border border-red-600 px-3 py-2 text-sm text-red-700 dark:text-red-400">
            {errorMessage}
          </p>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-2 border-t border-zinc-300 p-3 dark:border-zinc-700">
        <label htmlFor="chat-input" className="sr-only">
          Wiadomość do agenta
        </label>
        <textarea
          id="chat-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          maxLength={CHAT_MESSAGE_MAX_CHARS}
          rows={3}
          placeholder="Napisz do agenta… (Enter wysyła, Shift+Enter nowa linia)"
          className="w-full resize-none rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-300"
        />
        <div className="flex justify-end gap-2">
          {busy ? (
            <button
              type="button"
              onClick={() => void stop()}
              className="rounded-md border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Zatrzymaj
            </button>
          ) : null}
          <button
            type="submit"
            disabled={busy || input.trim().length === 0}
            className="rounded-md bg-zinc-900 px-3 py-1 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Wyślij
          </button>
        </div>
      </form>
    </section>
  );
}
