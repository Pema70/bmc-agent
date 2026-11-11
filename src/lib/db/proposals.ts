import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { applyProposal, type ApplyError } from "@/lib/bmc/proposals";
import { prisma } from "@/lib/db/client";
import { writeVariantStateIfVersion } from "@/lib/db/variants";
import { BlockKey, BmcState } from "@/lib/schemas/bmc";
import type { ProposalOperation, ProposalStatus, ProposeBlockChangeInput } from "@/lib/schemas/proposal";

// Każdy odczyt i zapis propozycji jest ograniczony do wariantu (variantId) należącego do projektu
// (variant.projectId). Przynależność do projektu sprawdza też wywołujący (Server Action / narzędzie).

type Tx = Prisma.TransactionClient;

export type ProposalRecord = {
  id: string;
  variantId: string;
  blockKey: BlockKey;
  operation: ProposalOperation;
  before: string | null;
  after: string | null;
  rationale: string;
  status: ProposalStatus;
  baseVersion: number;
  createdAt: Date;
};

type ProposalRow = {
  id: string;
  variantId: string;
  blockKey: string;
  operation: "ADD" | "EDIT" | "REMOVE";
  before: string | null;
  after: string | null;
  rationale: string;
  status: ProposalStatus;
  baseVersion: number;
  createdAt: Date;
};

const PROPOSAL_SELECT = {
  id: true,
  variantId: true,
  blockKey: true,
  operation: true,
  before: true,
  after: true,
  rationale: true,
  status: true,
  baseVersion: true,
  createdAt: true,
} as const;

const OPERATION_TO_DB = { add: "ADD", edit: "EDIT", remove: "REMOVE" } as const;
const OPERATION_FROM_DB = { ADD: "add", EDIT: "edit", REMOVE: "remove" } as const;

function toRecord(row: ProposalRow): ProposalRecord {
  const blockKey = BlockKey.safeParse(row.blockKey);
  if (!blockKey.success) {
    throw new Error(`Niepoprawny blockKey „${row.blockKey}” w propozycji ${row.id}.`);
  }
  return { ...row, blockKey: blockKey.data, operation: OPERATION_FROM_DB[row.operation] };
}

export type CreateProposalResult =
  | { ok: true; proposal: ProposalRecord }
  | { ok: false; error: "NOT_FOUND" | "LIMIT" | "DUPLICATE_PENDING" };

/**
 * Jedyne miejsce, które tworzy propozycje (id pochodzi z bazy, nigdy z tekstu modelu).
 * Limit oczekujących propozycji na wariant jest egzekwowany w transakcji z blokadą wiersza wariantu,
 * więc równoległe żądania nie przekroczą go o jedną.
 */
export async function createProposal(
  args: {
    projectId: string;
    variantId: string;
    createdById: string;
    baseVersion: number;
    change: ProposeBlockChangeInput;
  },
  maxPending: number,
): Promise<CreateProposalResult> {
  const { projectId, variantId, change } = args;

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "BmcVariant" WHERE "id" = ${variantId} AND "projectId" = ${projectId} FOR UPDATE`;
    if (locked.length === 0) {
      return { ok: false, error: "NOT_FOUND" } as const;
    }

    const pending = await tx.proposal.findMany({
      where: { variantId, status: "PENDING" },
      select: { blockKey: true, operation: true, before: true, after: true },
    });
    if (pending.length >= maxPending) {
      return { ok: false, error: "LIMIT" } as const;
    }
    const operation = OPERATION_TO_DB[change.operation];
    const identical = pending.some(
      (p) =>
        p.blockKey === change.blockKey && p.operation === operation && p.before === change.before && p.after === change.after,
    );
    if (identical) {
      return { ok: false, error: "DUPLICATE_PENDING" } as const;
    }

    const row = await tx.proposal.create({
      data: {
        variantId,
        blockKey: change.blockKey,
        operation,
        before: change.before,
        after: change.after,
        rationale: change.rationale,
        baseVersion: args.baseVersion,
        createdById: args.createdById,
      },
      select: PROPOSAL_SELECT,
    });
    return { ok: true, proposal: toRecord(row) } as const;
  });
}

/** Najnowsze propozycje wariantu (dowolnego statusu), tylko z wariantu należącego do projektu. */
export async function listProposalsForVariant(
  projectId: string,
  variantId: string,
  limit: number,
): Promise<ProposalRecord[]> {
  const rows = await prisma.proposal.findMany({
    where: { variantId, variant: { projectId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: PROPOSAL_SELECT,
  });
  return rows.map(toRecord);
}

/** Odczyt po id zawsze z filtrem po wariancie i projekcie: cudze id daje null. */
export async function findProposalInVariant(
  client: Pick<Tx, "proposal">,
  args: { projectId: string; variantId: string; proposalId: string },
): Promise<ProposalRecord | null> {
  const row = await client.proposal.findFirst({
    where: { id: args.proposalId, variantId: args.variantId, variant: { projectId: args.projectId } },
    select: PROPOSAL_SELECT,
  });
  return row ? toRecord(row) : null;
}

export type AcceptProposalResult =
  | { ok: true; state: BmcState; version: number; proposal: ProposalRecord }
  | { ok: false; error: "NOT_FOUND" | "ALREADY_RESOLVED" | "VERSION_CONFLICT" | ApplyError };

class RollbackSignal extends Error {
  constructor(readonly reason: "ALREADY_RESOLVED" | "VERSION_CONFLICT") {
    super(reason);
  }
}

/**
 * Zmiana stanu wariantu i statusu propozycji w jednej transakcji: albo oba zapisy, albo żaden.
 * Stan zmienia się tylko przy zgodnej wersji (expectedVersion) i tylko dla propozycji PENDING.
 */
export async function acceptProposal(args: {
  projectId: string;
  variantId: string;
  proposalId: string;
  expectedVersion: number;
  userId: string;
}): Promise<AcceptProposalResult> {
  const { projectId, variantId, proposalId, expectedVersion, userId } = args;

  try {
    return await prisma.$transaction(async (tx): Promise<AcceptProposalResult> => {
      const proposal = await findProposalInVariant(tx, { projectId, variantId, proposalId });
      if (!proposal) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if (proposal.status !== "PENDING") {
        return { ok: false, error: "ALREADY_RESOLVED" };
      }

      const variant = await tx.bmcVariant.findFirst({
        where: { id: variantId, projectId },
        select: { version: true, state: true },
      });
      if (!variant) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if (variant.version !== expectedVersion) {
        return { ok: false, error: "VERSION_CONFLICT" };
      }
      const state = BmcState.safeParse(variant.state);
      if (!state.success) {
        throw new Error(`Niepoprawny stan BMC w wariancie ${variantId}: ${z.prettifyError(state.error)}`);
      }

      const applied = applyProposal(state.data, proposal);
      if (!applied.ok) {
        return { ok: false, error: applied.error };
      }

      if ((await writeVariantStateIfVersion(tx, variantId, expectedVersion, applied.state)) === 0) {
        throw new RollbackSignal("VERSION_CONFLICT");
      }
      const resolved = await tx.proposal.updateMany({
        where: { id: proposalId, variantId, status: "PENDING" },
        data: { status: "ACCEPTED", resolvedById: userId, resolvedAt: new Date() },
      });
      if (resolved.count === 0) {
        // Ktoś rozstrzygnął propozycję równolegle: wycofujemy też zapis stanu.
        throw new RollbackSignal("ALREADY_RESOLVED");
      }

      return { ok: true, state: applied.state, version: expectedVersion + 1, proposal: { ...proposal, status: "ACCEPTED" } };
    });
  } catch (error) {
    if (error instanceof RollbackSignal) {
      return { ok: false, error: error.reason };
    }
    throw error;
  }
}

export type RejectProposalResult = { ok: true } | { ok: false; error: "NOT_FOUND" | "ALREADY_RESOLVED" };

/** Odrzucenie zmienia tylko status propozycji, stan BMC zostaje bez zmian. */
export async function rejectProposal(args: {
  projectId: string;
  variantId: string;
  proposalId: string;
  userId: string;
}): Promise<RejectProposalResult> {
  const { projectId, variantId, proposalId, userId } = args;

  const { count } = await prisma.proposal.updateMany({
    where: { id: proposalId, variantId, status: "PENDING", variant: { projectId } },
    data: { status: "REJECTED", resolvedById: userId, resolvedAt: new Date() },
  });
  if (count === 1) {
    return { ok: true };
  }

  const existing = await findProposalInVariant(prisma, { projectId, variantId, proposalId });
  return { ok: false, error: existing ? "ALREADY_RESOLVED" : "NOT_FOUND" };
}
