"use client";

import { useState, useTransition } from "react";
import { acceptProposalAction, rejectProposalAction } from "@/app/projekty/[id]/proposal-actions";
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
  projectId: string;
  variantId: string;
  version: number;
  onResolved: (proposalId: string, status: ProposalStatus, newVersion?: number) => void;
};

const buttonClass =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function ProposalCard({ proposal, status, projectId, variantId, version, onResolved }: ProposalCardProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function accept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptProposalAction(projectId, variantId, proposal.id, version);
      if (result.ok) {
        setNote("Zmiana zastosowana. Odśwież stronę, aby zobaczyć ją na płótnie.");
        onResolved(proposal.id, "ACCEPTED", result.version);
      } else {
        setError(result.message);
        if (result.error === "ALREADY_RESOLVED") {
          setNote(null);
        }
      }
    });
  }

  function reject() {
    setError(null);
    startTransition(async () => {
      const result = await rejectProposalAction(projectId, variantId, proposal.id);
      if (result.ok) {
        onResolved(proposal.id, "REJECTED");
      } else {
        setError(result.message);
      }
    });
  }

  // Wszystkie treści (uzasadnienie, before, after) to zwykły tekst: węzły tekstowe React, bez HTML.
  return (
    <div className="flex flex-col gap-2 rounded-md border-2 border-amber-500 bg-amber-50 p-3 dark:border-amber-400 dark:bg-amber-950/30">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-amber-500 px-1.5 py-0.5 font-semibold text-black">Propozycja AI</span>
        <span className="font-medium">{PROPOSAL_OPERATION_LABELS[proposal.operation]}</span>
        <span className="text-zinc-600 dark:text-zinc-400">w bloku: {BLOCK_INFO[proposal.blockKey].label}</span>
      </div>

      {proposal.before !== null ? (
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

      <p className="text-xs font-medium">
        {status ? PROPOSAL_STATUS_LABELS[status] : "Status nieznany"}
      </p>

      {status === "PENDING" ? (
        <div className="flex gap-2">
          <button type="button" onClick={accept} disabled={pending} className={buttonClass}>
            Zaakceptuj
          </button>
          <button type="button" onClick={reject} disabled={pending} className={buttonClass}>
            Odrzuć
          </button>
        </div>
      ) : null}

      {note ? <p className="text-xs text-green-800 dark:text-green-300">{note}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
