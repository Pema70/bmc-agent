import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { applyProposal, type ApplyError } from "@/lib/bmc/proposals";
import { prisma } from "@/lib/db/client";
import { writeVariantStateIfVersion } from "@/lib/db/variants";
import { BlockKey, BmcState } from "@/lib/schemas/bmc";
import type {
  ProposalOperation,
  ProposalSource,
  ProposalSourceKind,
  ProposalStatus,
  ProposeBlockChangeInput,
} from "@/lib/schemas/proposal";

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
  sourceKind: ProposalSourceKind;
  // Migawka nazwy pliku (niezaufany tekst), zostaje po usunięciu załącznika.
  sourceAttachmentName: string | null;
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
  sourceKind: ProposalSourceKind;
  sourceAttachmentName: string | null;
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
  sourceKind: true,
  sourceAttachmentName: true,
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

type SourceData = Pick<
  Prisma.ProposalUncheckedCreateInput,
  "sourceKind" | "sourceAttachmentId" | "sourceAttachmentName"
>;

/** Pola źródła do zapisu; {} bez źródła (działa domyślne CONVERSATION), null, gdy załącznik nie należy do projektu. */
async function resolveSourceData(
  tx: Tx,
  projectId: string,
  source: ProposalSource | undefined,
): Promise<SourceData | null> {
  if (!source) {
    return {};
  }
  if (source.kind !== "ATTACHMENT") {
    return { sourceKind: source.kind };
  }
  const attachment = await tx.attachment.findFirst({
    where: { id: source.attachmentId, projectId },
    select: { id: true, fileName: true },
  });
  if (!attachment) {
    return null;
  }
  return { sourceKind: "ATTACHMENT", sourceAttachmentId: attachment.id, sourceAttachmentName: attachment.fileName };
}

export type CreateProposalResult =
  | { ok: true; proposal: ProposalRecord }
  | { ok: false; error: "NOT_FOUND" | "LIMIT" | "DUPLICATE_PENDING" | "ATTACHMENT_NOT_FOUND" };

/**
 * Jedyne miejsce, które tworzy propozycje (id pochodzi z bazy, nigdy z tekstu modelu).
 * Limit oczekujących propozycji na wariant jest egzekwowany w transakcji z blokadą wiersza wariantu,
 * więc równoległe żądania nie przekroczą go o jedną.
 * Źródło (krok 7) jest opcjonalne; bez niego obowiązuje domyślne CONVERSATION z bazy. Dla załącznika serwer sprawdza
 * w tej samej transakcji, że należy do projektu, i zapisuje migawkę jego nazwy.
 */
export async function createProposal(
  args: {
    projectId: string;
    variantId: string;
    createdById: string;
    baseVersion: number;
    change: ProposeBlockChangeInput;
    source?: ProposalSource;
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

    const sourceData = await resolveSourceData(tx, projectId, args.source);
    if (sourceData === null) {
      return { ok: false, error: "ATTACHMENT_NOT_FOUND" } as const;
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
        ...sourceData,
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

/** Propozycja po id z filtrem po wariancie i projekcie (dla analizy wpływu); cudze id daje null. */
export async function getProposalInVariant(
  projectId: string,
  variantId: string,
  proposalId: string,
): Promise<ProposalRecord | null> {
  return findProposalInVariant(prisma, { projectId, variantId, proposalId });
}

/** Liczba oczekujących propozycji wariantu, tylko z wariantu należącego do projektu (np. do potwierdzenia zmiany głównego). */
export async function countPendingProposals(projectId: string, variantId: string): Promise<number> {
  return prisma.proposal.count({ where: { variantId, status: "PENDING", variant: { projectId } } });
}

export type BatchFailure = { proposalId: string; error: ApplyError };

export type AcceptRoundBatchResult =
  | { ok: true; state: BmcState; version: number; acceptedCount: number; proposalIds: string[] }
  | { ok: false; error: "NOT_FOUND" | "NOTHING_PENDING" | "ALREADY_RESOLVED" | "VERSION_CONFLICT" }
  // Którejś propozycji nie da się zastosować na bieżącym stanie: brak jakichkolwiek zmian, lista powodów.
  | { ok: false; error: "CONFLICTS"; failures: BatchFailure[] };

/**
 * „Zastosuj poprawki” (krok 7, D19): wszystkie propozycje PENDING rundy stosowane po kolei w JEDNEJ transakcji, albo
 * wszystkie, albo żadna. Kolejność: numer pytania, potem id (paczka jest zapisywana w tej kolejności).
 * Jeśli którakolwiek jest STALE, DUPLICATE lub LIMIT na bieżącym stanie, nic się nie zmienia, a wynik wymienia
 * propozycje i powody (użytkownik rozstrzyga je pojedynczo istniejącymi „Zaakceptuj” / „Odrzuć”). Stan zapisywany jest
 * tylko przy zgodnej wersji (`expectedVersion`), wersja rośnie o 1 niezależnie od liczby propozycji.
 */
export async function acceptRoundBatch(args: {
  projectId: string;
  variantId: string;
  roundId: string;
  expectedVersion: number;
  userId: string;
}): Promise<AcceptRoundBatchResult> {
  const { projectId, variantId, roundId, expectedVersion, userId } = args;

  try {
    return await prisma.$transaction(async (tx): Promise<AcceptRoundBatchResult> => {
      const round = await tx.refinementRound.findFirst({ where: { id: roundId, variantId, projectId }, select: { id: true } });
      if (!round) {
        return { ok: false, error: "NOT_FOUND" };
      }

      const rows = await tx.proposal.findMany({
        where: { refinementRoundId: roundId, variantId, status: "PENDING" },
        orderBy: [{ refinementQuestionIndex: "asc" }, { id: "asc" }],
        select: PROPOSAL_SELECT,
      });
      if (rows.length === 0) {
        return { ok: false, error: "NOTHING_PENDING" };
      }
      const proposals = rows.map(toRecord);

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
      const parsed = BmcState.safeParse(variant.state);
      if (!parsed.success) {
        throw new Error(`Niepoprawny stan BMC w wariancie ${variantId}: ${z.prettifyError(parsed.error)}`);
      }

      // Sprawdzenie wszystkich przed zapisem: niestosowalna propozycja nie przesuwa stanu, ale reszta jest dalej sprawdzana,
      // żeby odpowiedź wymieniła wszystkie problemy naraz.
      let working = parsed.data;
      const failures: BatchFailure[] = [];
      for (const proposal of proposals) {
        const applied = applyProposal(working, proposal);
        if (applied.ok) {
          working = applied.state;
        } else {
          failures.push({ proposalId: proposal.id, error: applied.error });
        }
      }
      if (failures.length > 0) {
        return { ok: false, error: "CONFLICTS", failures };
      }

      if ((await writeVariantStateIfVersion(tx, variantId, expectedVersion, working)) === 0) {
        throw new RollbackSignal("VERSION_CONFLICT");
      }
      const resolved = await tx.proposal.updateMany({
        where: { id: { in: proposals.map((proposal) => proposal.id) }, variantId, status: "PENDING" },
        data: { status: "ACCEPTED", resolvedById: userId, resolvedAt: new Date() },
      });
      if (resolved.count !== proposals.length) {
        // Któraś propozycja została rozstrzygnięta równolegle: wycofujemy też zapis stanu.
        throw new RollbackSignal("ALREADY_RESOLVED");
      }

      return {
        ok: true,
        state: working,
        version: expectedVersion + 1,
        acceptedCount: proposals.length,
        proposalIds: proposals.map((proposal) => proposal.id),
      };
    });
  } catch (error) {
    if (error instanceof RollbackSignal) {
      return { ok: false, error: error.reason };
    }
    throw error;
  }
}

/** Propozycje jednej rundy poprawek (dowolnego statusu) w kolejności paczki, tylko z wariantu należącego do projektu. */
export async function listProposalsForRound(projectId: string, variantId: string, roundId: string): Promise<ProposalRecord[]> {
  const rows = await prisma.proposal.findMany({
    where: { refinementRoundId: roundId, variantId, variant: { projectId } },
    orderBy: [{ refinementQuestionIndex: "asc" }, { id: "asc" }],
    select: PROPOSAL_SELECT,
  });
  return rows.map(toRecord);
}
