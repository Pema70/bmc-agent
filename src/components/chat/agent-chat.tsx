"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useVariantWorkspace } from "@/components/bmc/variant-workspace";
import { EvaluationCard } from "@/components/chat/evaluation-card";
import { ImpactCard } from "@/components/chat/impact-card";
import { ProposalCard } from "@/components/chat/proposal-card";
import { CHAT_MESSAGE_MAX_CHARS, type ChatUIMessage } from "@/lib/schemas/chat";
import type { ProposalView } from "@/lib/schemas/proposal";

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
  // Wersja, stan i propozycje wariantu są wspólne z edytorem płótna (VariantWorkspaceProvider).
  const workspace = useVariantWorkspace();
  const { registerProposals } = workspace;
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

  const router = useRouter();
  // Wyniki ciężkich narzędzi (ocena, analiza wpływu), po których odświeżono już stronę serwerową.
  const refreshedEvaluations = useRef(new Set<string>());
  const [input, setInput] = useState("");
  // Propozycje z wiadomości dołączonych w tej sesji są świeże (PENDING), starsze znamy z bazy.
  const [initialIds] = useState(() => new Set(initialMessages.map((message) => message.id)));
  const listRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";
  const errorMessage = errorText(error);

  // Przewija tylko listę wiadomości, a nie całą stronę: czat leży pod płótnem, więc przewinięcie okna zabrałoby widok z płótna.
  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages, status]);

  // Nowe propozycje z tej sesji trafiają do wspólnego stanu, więc od razu widać je jako diff w blokach.
  useEffect(() => {
    const fresh: ProposalView[] = [];
    for (const message of messages) {
      if (initialIds.has(message.id)) {
        continue;
      }
      for (const part of message.parts) {
        if (part.type === "tool-propose_block_change" && part.state === "output-available" && part.output.ok) {
          fresh.push(part.output.proposal);
        }
      }
    }
    if (fresh.length > 0) {
      registerProposals(fresh);
    }
  }, [messages, initialIds, registerProposals]);

  // Ocena i analiza wpływu z czatu pojawiają się w swoich panelach po odświeżeniu strony serwerowej na końcu tury.
  useEffect(() => {
    if (busy) {
      return;
    }
    let needsRefresh = false;
    for (const message of messages) {
      if (initialIds.has(message.id)) {
        continue;
      }
      for (const part of message.parts) {
        if (part.type === "tool-evaluate_bmc" && part.state === "output-available" && part.output.ok) {
          if (!refreshedEvaluations.current.has(part.output.evaluationId)) {
            refreshedEvaluations.current.add(part.output.evaluationId);
            needsRefresh = true;
          }
        }
        if (part.type === "tool-analyze_impact" && part.state === "output-available" && part.output.ok) {
          if (!refreshedEvaluations.current.has(part.output.analysisId)) {
            refreshedEvaluations.current.add(part.output.analysisId);
            needsRefresh = true;
          }
        }
      }
    }
    if (needsRefresh) {
      router.refresh();
    }
  }, [busy, messages, initialIds, router]);

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
      className="flex h-[26rem] flex-col sm:h-[28rem]"
      aria-labelledby="chat-heading"
    >
      <h2 id="chat-heading" className="sr-only">
        Agent BMC
      </h2>

      <div ref={listRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3" aria-live="polite">
        {messages.length === 0 ? (
          <p className="text-sm text-muted">
            Opisz swój pomysł na biznes, a agent dopyta o szczegóły i pomoże uporządkować model.
          </p>
        ) : null}

        {messages.map((message) => (
          <article
            key={message.id}
            className={
              message.role === "user"
                ? "ml-6 rounded-lg bg-tint px-3 py-2"
                : "mr-6 rounded-lg border border-border px-3 py-2"
            }
          >
            <p className="mb-1 text-xs font-medium text-muted">{message.role === "user" ? "Ty" : "Agent"}</p>
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
                                  className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-tint"
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
                        <p key={index} className="text-danger">
                          Agent zadał niepoprawne pytanie. Napisz, co chcesz zrobić dalej.
                        </p>
                      );
                    default:
                      return (
                        <p key={index} className="text-muted">
                          Agent formułuje pytanie…
                        </p>
                      );
                  }
                }
                if (part.type === "tool-propose_block_change") {
                  switch (part.state) {
                    case "output-available":
                      return part.output.ok ? (
                        <ProposalCard
                          key={part.output.proposal.id}
                          proposal={part.output.proposal}
                          status={
                            workspace.proposals[part.output.proposal.id]?.status ??
                            (initialIds.has(message.id) ? undefined : "PENDING")
                          }
                        />
                      ) : null;
                    case "output-error":
                      return (
                        <p key={index} className="text-danger">
                          Agent przygotował niepoprawną propozycję. Napisz, co chcesz zrobić dalej.
                        </p>
                      );
                    default:
                      return (
                        <p key={index} className="text-muted">
                          Agent przygotowuje propozycję…
                        </p>
                      );
                  }
                }
                if (part.type === "tool-evaluate_bmc") {
                  switch (part.state) {
                    case "output-available":
                      // Błąd oceny (limit, 429, 503) model opisuje własnym tekstem; karta tylko dla zapisanej oceny.
                      return part.output.ok ? (
                        <EvaluationCard
                          key={part.output.evaluationId}
                          projectId={projectId}
                          variantId={variantId}
                          evaluationId={part.output.evaluationId}
                        />
                      ) : null;
                    case "output-error":
                      return (
                        <p key={index} className="text-danger">
                          Ocena nie powiodła się. Spróbuj ponownie za chwilę.
                        </p>
                      );
                    default:
                      return (
                        <p key={index} className="text-muted">
                          Oceniam model…
                        </p>
                      );
                  }
                }
                if (part.type === "tool-read_attachment") {
                  switch (part.state) {
                    case "output-available":
                      return (
                        <p key={index} className="text-xs text-muted">
                          {part.output.ok
                            ? `Agent przeczytał załącznik: ${part.output.name}`
                            : "Agent próbował przeczytać załącznik, ale się nie udało."}
                        </p>
                      );
                    case "output-error":
                      return (
                        <p key={index} className="text-xs text-danger">
                          Nie udało się odczytać załącznika.
                        </p>
                      );
                    default:
                      return (
                        <p key={index} className="text-xs text-muted">
                          Agent czyta załącznik…
                        </p>
                      );
                  }
                }
                if (part.type === "tool-analyze_impact") {
                  switch (part.state) {
                    case "output-available":
                      // Błąd analizy (limit, 429, 503) model opisuje własnym tekstem; karta tylko dla zapisanej analizy.
                      return part.output.ok ? (
                        <ImpactCard
                          key={part.output.analysisId}
                          projectId={projectId}
                          variantId={variantId}
                          analysisId={part.output.analysisId}
                        />
                      ) : null;
                    case "output-error":
                      return (
                        <p key={index} className="text-danger">
                          Analiza wpływu nie powiodła się. Spróbuj ponownie za chwilę.
                        </p>
                      );
                    default:
                      return (
                        <p key={index} className="text-muted">
                          Analizuję wpływ zmiany…
                        </p>
                      );
                  }
                }
                return null;
              })}
            </div>
          </article>
        ))}

        {status === "submitted" ? <p className="text-sm text-muted">Agent pisze…</p> : null}
        {errorMessage ? (
          <p role="alert" className="rounded-lg border border-danger px-3 py-2 text-sm text-danger">
            {errorMessage}
          </p>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-2 border-t border-border p-3">
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
          className="w-full resize-none rounded-lg border border-border bg-surface px-2 py-1 text-sm text-text outline-none focus:border-ring"
        />
        <div className="flex justify-end gap-2">
          {busy ? (
            <button
              type="button"
              onClick={() => void stop()}
              className="rounded-lg border border-border px-3 py-1 text-sm hover:bg-tint"
            >
              Zatrzymaj
            </button>
          ) : null}
          <button
            type="submit"
            disabled={busy || input.trim().length === 0}
            className="rounded-lg bg-cta px-3 py-1 text-sm font-bold disabled:opacity-50"
          >
            Wyślij
          </button>
        </div>
      </form>
    </section>
  );
}
