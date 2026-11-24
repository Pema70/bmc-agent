"use client";

import { useRef, useState } from "react";
import {
  applyRoundAction,
  cancelRoundAction,
  startRefinementRoundAction,
  submitAnswersAction,
  type ApplyRoundFailure,
} from "@/app/projekty/[id]/refinement-actions";
import { AiBadge, AiNotice } from "@/components/ai/ai-notice";
import { useVariantWorkspace } from "@/components/bmc/variant-workspace";
import { ProposalCard } from "@/components/chat/proposal-card";
import { useOpenPanel } from "@/components/project/panel-context";
import type { RefinementRoundListItem } from "@/lib/db/refinement";
import { formatEvaluationDate } from "@/lib/evaluation/format";
import {
  PHASE_LABELS,
  REEVALUATE_MESSAGE,
  REFINEMENT_LABEL,
  REFINEMENT_NOTICE,
  SUGGESTION_NOTICE,
  applyAvailability,
  cancelPrompt,
  describeAppliedCount,
  isActivePhase,
  normalizeAnswers,
  pluralProposals,
  roundLabel,
  roundPhase,
  shouldShowReevaluateBanner,
  startAvailability,
  startNotice,
  submitAvailability,
  submitNotice,
  EMPTY_BATCH_NOTE,
} from "@/lib/refinement/presentation";
import { BLOCK_INFO } from "@/lib/schemas/bmc";
import { CRITERION_LABELS } from "@/lib/schemas/evaluation";
import type { ProposalStatus } from "@/lib/schemas/proposal";
import { ANSWER_MAX_CHARS, MAX_REFINEMENT_ROUNDS, type RefinementRoundView } from "@/lib/schemas/refinement";

type Props = {
  // Rundy wariantu od pierwszej (z serwera) i identyfikatory propozycji każdej rundy.
  initialRounds: RefinementRoundListItem[];
  initialRoundProposalIds: Record<string, string[]>;
  // Wersja wariantu, której dotyczy najnowsza zapisana ocena (null, gdy nie ma żadnej czytelnej oceny).
  latestEvaluationVersion: number | null;
};

type Busy = "start" | "submit" | "apply" | "cancel" | null;
type Message = { kind: "error" | "note"; text: string };

const GENERIC_ERROR = "Nie udało się wykonać operacji. Sprawdź połączenie i spróbuj ponownie.";
const buttonClass =
  "rounded-lg border border-border px-3 py-1.5 text-sm font-bold hover:bg-tint disabled:opacity-50";
const primaryButtonClass =
  "rounded-lg bg-cta px-4 py-2 text-sm font-bold hover:bg-tint disabled:opacity-50";

/**
 * Panel „Cykl poprawek” (krok 7g): ocena → pytania → odpowiedzi → paczka propozycji → „Zastosuj poprawki” → ocena „po”.
 * Działa na wybranym wariancie (EDITOR+) i dzieli stan z płótnem przez przestrzeń roboczą: propozycje rundy są tam
 * widoczne jako diff, a decyzje (pojedyncze lub całą paczką) zmieniają stan płótna. Wszystkie treści (pytania,
 * podpowiedzi, odpowiedzi, wpisy, uzasadnienia) to węzły tekstowe React, bez HTML i Markdown. Nic nie wywołuje modelu
 * poza kliknięciem „Rozpocznij rundę” i „Przygotuj poprawki”; ocena „po” jest osobnym, jawnym przyciskiem w panelu oceny.
 */
export function RefinementPanel({ initialRounds, initialRoundProposalIds, latestEvaluationVersion }: Props) {
  const workspace = useVariantWorkspace();
  const openPanel = useOpenPanel();
  const { projectId, variantId, version, dirty } = workspace;

  const [rounds, setRounds] = useState<RefinementRoundListItem[]>(initialRounds);
  const [roundProposalIds, setRoundProposalIds] = useState<Record<string, string[]>>(initialRoundProposalIds);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [failures, setFailures] = useState<{ roundId: string; items: ApplyRoundFailure[] } | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState<string | null>(null);
  // Chroni przed podwójnym uruchomieniem w tej samej chwili (stan React aktualizuje się asynchronicznie).
  const runningRef = useRef(false);

  // Po odświeżeniu strony serwer przekazuje świeże dane rund: przyjmujemy je, gdy żadna operacja nie trwa.
  const [seenRounds, setSeenRounds] = useState(initialRounds);
  const [seenIds, setSeenIds] = useState(initialRoundProposalIds);
  if ((seenRounds !== initialRounds || seenIds !== initialRoundProposalIds) && busy === null) {
    setSeenRounds(initialRounds);
    setSeenIds(initialRoundProposalIds);
    setRounds(initialRounds);
    setRoundProposalIds(initialRoundProposalIds);
  }

  const anyBusy = busy !== null || workspace.busy !== null;

  function statusesOf(roundId: string): ProposalStatus[] {
    return (roundProposalIds[roundId] ?? []).flatMap((id) => {
      const item = workspace.proposals[id];
      return item ? [item.status] : [];
    });
  }

  const okRounds = rounds.flatMap((item) => (item.ok ? [item.round] : []));
  const phaseOf = (round: RefinementRoundView) => roundPhase(round.status, statusesOf(round.id));
  const hasActiveRound = okRounds.some((round) => isActivePhase(phaseOf(round)));
  const roundsUsed = rounds.length;
  const latestRound = okRounds.reduce<RefinementRoundView | null>((best, round) => (!best || round.roundNumber > best.roundNumber ? round : best), null);
  const latestAccepted = latestRound ? statusesOf(latestRound.id).filter((status) => status === "ACCEPTED").length : 0;

  const start = startAvailability({ roundsUsed, hasActiveRound, dirty, version, latestEvaluationVersion });
  const showReevaluate = shouldShowReevaluateBanner({ latestRoundAcceptedCount: latestAccepted, version, latestEvaluationVersion });

  async function run(kind: Exclude<Busy, null>, work: () => Promise<void>) {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    setBusy(kind);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      console.error("Operacja cyklu poprawek nie powiodła się", error);
      setMessage({ kind: "error", text: GENERIC_ERROR });
    } finally {
      runningRef.current = false;
      setBusy(null);
    }
  }

  function startRound() {
    if (!start.enabled) {
      return;
    }
    void run("start", async () => {
      setFailures(null);
      const result = await startRefinementRoundAction(projectId, variantId, version);
      if (result.ok) {
        setRounds((current) => [...current, { ok: true, round: result.round }]);
        setDrafts((current) => ({ ...current, [result.round.id]: result.round.questions.map(() => "") }));
      } else {
        setMessage({ kind: "error", text: result.message });
      }
    });
  }

  function submitAnswers(round: RefinementRoundView) {
    const answers = normalizeAnswers(drafts[round.id] ?? [], round.questions.length);
    if (!submitAvailability({ dirty, drafts: answers, questionCount: round.questions.length }).enabled) {
      return;
    }
    void run("submit", async () => {
      const result = await submitAnswersAction(projectId, variantId, { roundId: round.id, expectedVersion: version, answers });
      if (!result.ok) {
        setMessage({ kind: "error", text: result.message });
        return;
      }
      workspace.registerProposals(result.proposals);
      setRoundProposalIds((current) => ({ ...current, [round.id]: result.proposalIds }));
      setRounds((current) =>
        current.map((item) => (item.ok && item.round.id === round.id ? { ok: true, round: { ...item.round, status: "PROPOSED", answers } } : item)),
      );
      setMessage({
        kind: "note",
        text: result.message ?? `Przygotowano ${pluralProposals(result.proposalIds.length)}. Są widoczne na płótnie i w tej rundzie.`,
      });
    });
  }

  function applyRound(round: RefinementRoundView) {
    const availability = applyAvailability({ dirty, pendingCount: statusesOf(round.id).filter((status) => status === "PENDING").length });
    if (!availability.enabled) {
      return;
    }
    void run("apply", async () => {
      setFailures(null);
      const result = await applyRoundAction(projectId, variantId, round.id, version);
      if (result.ok) {
        workspace.applyBatch(result.version, result.state, result.acceptedProposalIds);
        setMessage({ kind: "note", text: `${describeAppliedCount(result.acceptedCount)} ${REEVALUATE_MESSAGE}` });
        return;
      }
      if (result.error === "CONFLICTS" && result.failures) {
        setFailures({ roundId: round.id, items: result.failures });
      }
      setMessage({ kind: "error", text: result.message });
    });
  }

  function cancelRound(round: RefinementRoundView) {
    void run("cancel", async () => {
      const result = await cancelRoundAction(projectId, variantId, round.id);
      setConfirmingCancel(null);
      if (result.ok) {
        setRounds((current) =>
          current.map((item) => (item.ok && item.round.id === round.id ? { ok: true, round: { ...item.round, status: "CANCELLED" } } : item)),
        );
        setMessage({ kind: "note", text: result.message });
      } else {
        setMessage({ kind: "error", text: result.message });
      }
    });
  }

  function setAnswer(roundId: string, count: number, index: number, value: string) {
    setDrafts((current) => {
      const next = Array.from({ length: count }, (_, i) => current[roundId]?.[i] ?? "");
      next[index] = value;
      return { ...current, [roundId]: next };
    });
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="refinement-heading">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="refinement-heading" className="sr-only">
          Cykl poprawek
        </h2>
        <AiBadge label={REFINEMENT_LABEL} />
        <span className="text-sm text-muted">
          Wykorzystano {Math.min(roundsUsed, MAX_REFINEMENT_ROUNDS)} z {MAX_REFINEMENT_ROUNDS} rund
        </span>
      </div>
      <AiNotice>{REFINEMENT_NOTICE}</AiNotice>

      <div className="flex flex-col items-start gap-2">
        <button type="button" onClick={startRound} disabled={anyBusy || !start.enabled} className={primaryButtonClass}>
          {busy === "start" ? "Przygotowuję pytania…" : "Rozpocznij rundę"}
        </button>
        {roundsUsed < MAX_REFINEMENT_ROUNDS ? (
          <p className="text-sm text-muted">{startNotice(roundsUsed)}</p>
        ) : null}
        {start.reason ? (
          <p role="status" className="text-sm text-muted">
            {start.reason}
            {start.needsEvaluation ? (
              <>
                {" "}
                <button type="button" onClick={() => openPanel("ocena")} className="cursor-pointer font-bold underline">
                  Przejdź do oceny modelu
                </button>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={message.kind === "error" ? "text-sm text-danger" : "text-sm text-low-fg"}
        >
          {message.text}
        </p>
      ) : null}

      {showReevaluate ? (
        <p role="status" className="rounded-xl border border-ai-border bg-ai-bg p-3 text-sm">
          {REEVALUATE_MESSAGE}{" "}
          <button type="button" onClick={() => openPanel("ocena")} className="cursor-pointer font-bold underline">
            Przejdź do oceny modelu
          </button>
        </p>
      ) : null}

      {rounds.length === 0 ? (
        <p className="text-sm text-muted">Ten wariant nie miał jeszcze rundy poprawek.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {[...rounds].reverse().map((item) => {
            if (!item.ok) {
              return (
                <li key={item.id} className="rounded-xl border border-danger p-3 text-sm text-danger">
                  Nie można wyświetlić zapisanej rundy {item.roundNumber} ({item.id}): zapis jest uszkodzony.
                </li>
              );
            }
            const round = item.round;
            const phase = phaseOf(round);
            const proposalIds = roundProposalIds[round.id] ?? [];
            const pendingCount = statusesOf(round.id).filter((status) => status === "PENDING").length;
            const apply = applyAvailability({ dirty, pendingCount });
            const answers = normalizeAnswers(drafts[round.id] ?? [], round.questions.length);
            const submit = submitAvailability({ dirty, drafts: answers, questionCount: round.questions.length });
            const confirming = confirmingCancel === round.id;

            return (
              <li key={round.id} className="flex flex-col gap-3 rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{roundLabel(round.roundNumber)}</h3>
                  <span className="text-xs text-muted">
                    {PHASE_LABELS[phase]} · {formatEvaluationDate(round.createdAt)} · wersja modelu: {round.variantVersion}
                  </span>
                </div>

                {phase === "AWAITING_ANSWERS" ? (
                  <div className="flex flex-col gap-4">
                    <ol className="flex flex-col gap-4">
                      {round.questions.map((question, index) => {
                        const fieldId = `answer-${round.id}-${index}`;
                        return (
                          <li key={index} className="flex flex-col gap-1">
                            <label htmlFor={fieldId} className="text-sm font-medium">
                              {index + 1}. {question.question}
                            </label>
                            <span className="text-xs text-muted">
                              Blok: {BLOCK_INFO[question.blockKey].label} · kryterium: {CRITERION_LABELS[question.criterion]}
                            </span>
                            <textarea
                              id={fieldId}
                              value={drafts[round.id]?.[index] ?? ""}
                              onChange={(event) => setAnswer(round.id, round.questions.length, index, event.target.value)}
                              disabled={anyBusy}
                              maxLength={ANSWER_MAX_CHARS}
                              rows={2}
                              placeholder="Odpowiedź (puste pole = pomiń pytanie)"
                              className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm"
                            />
                            {question.suggestedAnswers.length > 0 ? (
                              <div className="flex flex-col gap-1">
                              <div className="flex flex-wrap gap-2" role="group" aria-label="Podpowiedzi odpowiedzi">
                                {question.suggestedAnswers.map((suggestion) => (
                                  <button
                                    key={suggestion}
                                    type="button"
                                    onClick={() => setAnswer(round.id, round.questions.length, index, suggestion)}
                                    disabled={anyBusy}
                                    className={`${buttonClass} !px-2 !py-1 !text-xs`}
                                  >
                                    {suggestion}
                                  </button>
                                ))}
                              </div>
                              <p className="text-xs text-muted">{SUGGESTION_NOTICE}</p>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                    <div className="flex flex-col items-start gap-2">
                      <button
                        type="button"
                        onClick={() => submitAnswers(round)}
                        disabled={anyBusy || !submit.enabled}
                        className={primaryButtonClass}
                      >
                        {busy === "submit" ? "Przygotowuję poprawki…" : "Przygotuj poprawki"}
                      </button>
                      <p className="text-sm text-muted">{submitNotice(round.roundNumber)}</p>
                      {submit.reason ? <p className="text-sm text-muted">{submit.reason}</p> : null}
                    </div>
                  </div>
                ) : null}

                {phase === "EMPTY" ? <p className="text-sm">{EMPTY_BATCH_NOTE}</p> : null}
                {phase === "CANCELLED" ? (
                  <p className="text-sm text-muted">
                    Runda zamknięta i wliczona do limitu {MAX_REFINEMENT_ROUNDS} rund.
                    {proposalIds.length > 0 ? " Propozycje, których nie rozstrzygnięto, nadal możesz zaakceptować lub odrzucić." : ""}
                  </p>
                ) : null}

                {proposalIds.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">Propozycje rundy ({proposalIds.length}); zmiany widać też na płótnie</p>
                    {proposalIds.map((id) => {
                      const proposal = workspace.proposals[id];
                      return proposal ? <ProposalCard key={id} proposal={proposal} status={proposal.status} /> : null;
                    })}
                  </div>
                ) : null}

                {phase === "PENDING" ? (
                  <div className="flex flex-col items-start gap-2">
                    <button
                      type="button"
                      onClick={() => applyRound(round)}
                      disabled={anyBusy || !apply.enabled}
                      className={primaryButtonClass}
                    >
                      {busy === "apply" ? "Stosuję…" : `Zastosuj poprawki (${pendingCount})`}
                    </button>
                    {apply.reason ? <p className="text-sm text-muted">{apply.reason}</p> : null}
                  </div>
                ) : null}

                {failures && failures.roundId === round.id ? (
                  <ul className="flex flex-col gap-1 text-sm text-danger" aria-label="Propozycje, których nie da się zastosować">
                    {failures.items.map((failure) => {
                      const proposal = workspace.proposals[failure.proposalId];
                      return (
                        <li key={failure.proposalId}>
                          {proposal ? `${proposal.after ?? proposal.before ?? "Propozycja"}: ` : ""}
                          {failure.message}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}

                {round.status !== "AWAITING_ANSWERS" ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer font-medium">Pytania i odpowiedzi</summary>
                    <ol className="mt-2 flex flex-col gap-2">
                      {round.questions.map((question, index) => (
                        <li key={index} className="flex flex-col gap-0.5">
                          <span>
                            {index + 1}. {question.question}
                          </span>
                          <span className="whitespace-pre-wrap break-words text-muted">
                            Odpowiedź: {round.answers?.[index] ? round.answers[index] : "(pominięto)"}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </details>
                ) : null}

                {isActivePhase(phase) ? (
                  confirming ? (
                    <div className="flex flex-col gap-2" role="group" aria-label={`Potwierdzenie zamknięcia rundy ${round.roundNumber}`}>
                      <p className="text-sm">{cancelPrompt(round.roundNumber)}</p>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => cancelRound(round)} disabled={anyBusy} className={buttonClass}>
                          {busy === "cancel" ? "Zamykanie…" : "Potwierdź zamknięcie"}
                        </button>
                        <button type="button" onClick={() => setConfirmingCancel(null)} disabled={anyBusy} className={buttonClass}>
                          Anuluj
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <button type="button" onClick={() => setConfirmingCancel(round.id)} disabled={anyBusy} className={buttonClass}>
                        Zamknij rundę
                      </button>
                    </div>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
