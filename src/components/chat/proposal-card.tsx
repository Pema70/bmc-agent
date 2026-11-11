"use client";

import { DIRTY_MESSAGE, useVariantWorkspace } from "@/components/bmc/variant-workspace";
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

const buttonClass =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function ProposalCard({ proposal, status, compact = false }: ProposalCardProps) {
  const workspace = useVariantWorkspace();
  const { busy, dirty, feedback } = workspace;

  const pending = status === "PENDING";
  const anyBusy = busy !== null;
  const thisBusy = busy?.id === proposal.id;
  // Aktualność względem stanu zapisanego na serwerze, bo na nim działa akceptacja.
  const check = pending ? checkProposable(workspace.serverState, proposal) : null;
  const staleReason = check && !check.ok ? check.error : null;
  const canAccept = pending && staleReason === null && !dirty && !anyBusy;
  const message = feedback[proposal.id];

  // Wszystkie treści (uzasadnienie, before, after) to zwykły tekst: węzły tekstowe React, bez HTML.
  return (
    <div
      className={`flex flex-col gap-2 rounded-md border-2 p-2 text-sm ${
        staleReason
          ? "border-zinc-400 bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-900"
          : "border-amber-500 bg-amber-50 dark:border-amber-400 dark:bg-amber-950/30"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-amber-500 px-1.5 py-0.5 font-semibold text-black">Propozycja AI</span>
        <span className="font-medium">{PROPOSAL_OPERATION_LABELS[proposal.operation]}</span>
        {compact ? null : (
          <span className="text-zinc-600 dark:text-zinc-400">w bloku: {BLOCK_INFO[proposal.blockKey].label}</span>
        )}
        {staleReason ? (
          <span className="rounded bg-zinc-500 px-1.5 py-0.5 font-semibold text-white">Nieaktualna</span>
        ) : null}
      </div>

      {proposal.before !== null && !compact ? (
        <p className="whitespace-pre-wrap break-words rounded bg-red-100 px-2 py-1 text-red-900 line-through dark:bg-red-950/50 dark:text-red-200">
          <span className="sr-only">Usuwany wpis: </span>
          {proposal.before}
        </p>
      ) : null}
      {proposal.after !== null ? (
        <p className="whitespace-pre-wrap break-words rounded bg-green-100 px-2 py-1 text-green-900 dark:bg-green-950/50 dark:text-green-200">
          <span className="sr-only">Nowy wpis: </span>
          {proposal.after}
        </p>
      ) : null}
      <p className="whitespace-pre-wrap break-words text-xs text-zinc-700 dark:text-zinc-300">
        Uzasadnienie: {proposal.rationale}
      </p>

      {compact && pending ? null : (
        <p className="text-xs font-medium">{status ? PROPOSAL_STATUS_LABELS[status] : "Status nieznany"}</p>
      )}

      {staleReason ? (
        <p className="text-xs text-zinc-700 dark:text-zinc-300">{APPLY_ERROR_MESSAGES[staleReason]}</p>
      ) : null}

      {pending && dirty && !staleReason ? (
        <p role="status" className="text-xs text-amber-900 dark:text-amber-200">
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
        </div>
      ) : null}

      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`text-xs ${message.kind === "error" ? "text-red-700 dark:text-red-400" : "text-green-800 dark:text-green-300"}`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
