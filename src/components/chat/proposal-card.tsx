"use client";

import { DIRTY_MESSAGE, useVariantWorkspace } from "@/components/bmc/variant-workspace";
import { useOptionalImpact } from "@/components/impact/impact-provider";
import { APPLY_ERROR_MESSAGES, checkProposable } from "@/lib/bmc/proposals";
import { BLOCK_INFO } from "@/lib/schemas/bmc";
import {
  PROPOSAL_OPERATION_LABELS,
  PROPOSAL_STATUS_LABELS,
  type ProposalStatus,
  type ProposalView,
} from "@/lib/schemas/proposal";

type ProposalCardProps = {
  proposal: ProposalView;
  // undefined: status nieznany (np. starsza propozycja spoza ostatnio pobranych), bez przycisków.
  status: ProposalStatus | undefined;
  // W bloku płótna wpis do zmiany lub usunięcia jest już pokazany na czerwono, więc karta pomija "before".
  compact?: boolean;
};

// Źródło propozycji; nazwa pliku to niezaufany tekst, wyświetlany wyłącznie jako węzeł tekstowy.
function describeProposalSource(proposal: ProposalView): string | null {
  switch (proposal.sourceKind) {
    case "ATTACHMENT":
      return `Źródło: załącznik ${proposal.sourceAttachmentName ?? "(usunięty)"}`;
    case "MODEL_KNOWLEDGE":
      return "Źródło: ogólna wiedza modelu (nie dane użytkownika)";
    case "REFINEMENT":
      return "Źródło: cykl poprawek";
    default:
      return null;
  }
}

const buttonClass =
  "rounded-lg border border-border px-2 py-1 text-xs font-bold hover:bg-tint disabled:opacity-50";

export function ProposalCard({ proposal, status, compact = false }: ProposalCardProps) {
  const workspace = useVariantWorkspace();
  const impact = useOptionalImpact();
  const { busy, dirty, feedback } = workspace;

  const pending = status === "PENDING";
  const anyBusy = busy !== null;
  const thisBusy = busy?.id === proposal.id;
  // Aktualność względem stanu zapisanego na serwerze, bo na nim działa akceptacja.
  const check = pending ? checkProposable(workspace.serverState, proposal) : null;
  const staleReason = check && !check.ok ? check.error : null;
  const canAccept = pending && staleReason === null && !dirty && !anyBusy;
  const message = feedback[proposal.id];
  const sourceText = describeProposalSource(proposal);
  // Analiza wpływu: tylko dla oczekującej propozycji, którą da się zastosować, i bez niezapisanych zmian.
  const scope = `proposal:${proposal.id}` as const;
  const canAnalyze = impact !== null && impact.canAnalyze && pending && staleReason === null;
  const analyzing = impact?.pendingScope === scope;
  const impactError = impact?.error?.scope === scope ? impact.error.text : null;

  // Wszystkie treści (uzasadnienie, before, after) to zwykły tekst: węzły tekstowe React, bez HTML.
  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border-2 p-2 text-sm ${ staleReason ? "border-border bg-tint" : "border-ai-border bg-ai-bg" }`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded border border-ai-border bg-ai-bg px-1.5 py-0.5 font-semibold text-ai-fg">Propozycja AI</span>
        <span className="font-medium">{PROPOSAL_OPERATION_LABELS[proposal.operation]}</span>
        {compact ? null : (
          <span className="text-muted">w bloku: {BLOCK_INFO[proposal.blockKey].label}</span>
        )}
        {staleReason ? (
          <span className="rounded border border-border bg-tint px-1.5 py-0.5 font-semibold text-text">Nieaktualna</span>
        ) : null}
      </div>

      {proposal.before !== null && !compact ? (
        <p className="whitespace-pre-wrap break-words rounded bg-high-bg px-2 py-1 text-high-fg line-through">
          <span className="sr-only">Usuwany wpis: </span>
          {proposal.before}
        </p>
      ) : null}
      {proposal.after !== null ? (
        <p className="whitespace-pre-wrap break-words rounded bg-low-bg px-2 py-1 text-low-fg">
          <span className="sr-only">Nowy wpis: </span>
          {proposal.after}
        </p>
      ) : null}
      <p className="whitespace-pre-wrap break-words text-xs text-muted">
        Uzasadnienie: {proposal.rationale}
      </p>
      {sourceText ? <p className="break-words text-xs text-muted">{sourceText}</p> : null}

      {compact && pending ? null : (
        <p className="text-xs font-medium">{status ? PROPOSAL_STATUS_LABELS[status] : "Status nieznany"}</p>
      )}

      {staleReason ? (
        <p className="text-xs text-muted">{APPLY_ERROR_MESSAGES[staleReason]}</p>
      ) : null}

      {pending && dirty && !staleReason ? (
        <p role="status" className="text-xs text-medium-fg">
          {DIRTY_MESSAGE}
        </p>
      ) : null}

      {pending ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void workspace.accept(proposal.id)}
            disabled={!canAccept}
            className={buttonClass}
          >
            {thisBusy && busy?.kind === "accept" ? "Stosowanie…" : "Zaakceptuj"}
          </button>
          <button
            type="button"
            onClick={() => void workspace.reject(proposal.id)}
            disabled={anyBusy}
            className={buttonClass}
          >
            {thisBusy && busy?.kind === "reject" ? "Odrzucanie…" : "Odrzuć"}
          </button>
          {canAnalyze ? (
            <button
              type="button"
              onClick={() => void impact.analyze(scope, { kind: "PROPOSAL", proposalId: proposal.id })}
              disabled={dirty || impact.pendingScope !== null}
              className={buttonClass}
            >
              {analyzing ? "Analizuję…" : "Analizuj wpływ"}
            </button>
          ) : null}
        </div>
      ) : null}

      {impactError ? (
        <p role="alert" className="text-xs text-danger">
          {impactError}
        </p>
      ) : null}

      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`text-xs ${message.kind === "error" ? "text-danger" : "text-low-fg"}`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
