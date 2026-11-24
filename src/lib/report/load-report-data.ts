import { listAttachmentsForProject } from "@/lib/db/attachments";
import { listVariantComparisonsForVariant } from "@/lib/db/comparisons";
import { listEvaluationsForVariant } from "@/lib/db/evaluations";
import { listImpactAnalysesForVariant } from "@/lib/db/impact";
import { getProject } from "@/lib/db/projects";
import { listRoundsForVariant } from "@/lib/db/refinement";
import { getStrategyCandidate, getVariantForReport, listLlmCallSummary, listProposalsForReport } from "@/lib/db/report";
import { describeAllBlocks, type DescribedProposal } from "@/lib/report/describe-blocks";
import { resolveEntryOrigins, type FallbackProposal } from "@/lib/report/provenance";
import { pairRoundEvaluations } from "@/lib/report/round-evaluations";
import { REPORT_LIMITS, type Limited, type ReportData, type ReportRoundProposal } from "@/lib/report/types";

function limited<T>(rows: readonly T[], limit: number): Limited<T> {
  return { items: rows.slice(0, limit), truncated: rows.length > limit, limit };
}

/**
 * Składa dane raportu wariantu wyłącznie z zapisanych danych (0 wywołań modelu, nic nie jest zapisywane). Każdy odczyt jest
 * ograniczony do projektu z uprawnień (wariant: do projektu ORAZ wariantu). Zwraca null, gdy wariant nie należy do projektu.
 * Wywołujący ma już sprawdzoną sesję i rolę (route handler).
 */
export async function loadReportData(projectId: string, variantId: string, now: Date): Promise<ReportData | null> {
  const variant = await getVariantForReport(projectId, variantId);
  const project = variant ? await getProject(projectId) : null;
  if (!variant || !project) {
    return null;
  }

  const [attachments, evaluationRows, rounds, impactRows, comparisonRows, llmSummary, proposalRows, candidate] = await Promise.all([
    listAttachmentsForProject(projectId),
    listEvaluationsForVariant(projectId, variantId, REPORT_LIMITS.evaluations + 1),
    listRoundsForVariant(projectId, variantId),
    listImpactAnalysesForVariant(projectId, variantId, REPORT_LIMITS.impacts + 1),
    listVariantComparisonsForVariant(projectId, variantId, REPORT_LIMITS.comparisons + 1),
    listLlmCallSummary(projectId),
    listProposalsForReport(projectId, variantId, REPORT_LIMITS.proposals + 1),
    variant.generationId !== null && variant.generationIndex !== null
      ? getStrategyCandidate(projectId, variant.generationId, variant.generationIndex)
      : Promise.resolve(null),
  ]);

  const proposalsTruncated = proposalRows.length > REPORT_LIMITS.proposals;
  const proposals = proposalRows.slice(0, REPORT_LIMITS.proposals);
  const evaluations = limited(evaluationRows, REPORT_LIMITS.evaluations);

  const roundNumbers = new Map<string, number>();
  for (const item of rounds) {
    if (item.ok) {
      roundNumbers.set(item.round.id, item.round.roundNumber);
    }
  }
  const withRound = proposals.map((proposal) => ({
    ...proposal,
    roundNumber: proposal.refinementRoundId ? (roundNumbers.get(proposal.refinementRoundId) ?? null) : null,
    questionIndex: proposal.refinementQuestionIndex,
  }));
  const fallback: FallbackProposal[] = withRound;
  const described: DescribedProposal[] = withRound;

  const origins = resolveEntryOrigins({ state: variant.state, storedOrigins: variant.entryOrigins, proposals: fallback, strategy: candidate });

  // Lista jest od najnowszych; w rundzie porządkujemy po numerze pytania (stabilnie, a przy równych po kolejności powstania).
  const roundProposals: ReportRoundProposal[] = [...proposals]
    .reverse()
    .flatMap((proposal) =>
      proposal.refinementRoundId
        ? [
            {
              refinementRoundId: proposal.refinementRoundId,
              questionIndex: proposal.refinementQuestionIndex,
              blockKey: proposal.blockKey,
              operation: proposal.operation,
              before: proposal.before,
              after: proposal.after,
              status: proposal.status,
            },
          ]
        : [],
    )
    .sort((a, b) => (a.questionIndex ?? Number.MAX_SAFE_INTEGER) - (b.questionIndex ?? Number.MAX_SAFE_INTEGER));

  const usedNames = new Set<string>();
  for (const entry of origins.entries) {
    if (entry.origin?.attachmentName) {
      usedNames.add(entry.origin.attachmentName);
    }
  }
  for (const proposal of proposals) {
    if (proposal.status === "ACCEPTED" && proposal.sourceKind === "ATTACHMENT" && proposal.sourceAttachmentName) {
      usedNames.add(proposal.sourceAttachmentName);
    }
  }

  return {
    generatedAt: now,
    project: { name: project.name, description: project.description },
    variant: {
      name: variant.name,
      isMain: variant.isMain,
      origin: variant.origin,
      description: variant.description,
      version: variant.version,
      createdAt: variant.createdAt,
      updatedAt: variant.updatedAt,
    },
    state: variant.state,
    origins,
    blocks: describeAllBlocks(origins.entries, described),
    attachments: attachments.map((attachment) => ({
      ordinal: attachment.ordinal,
      fileName: attachment.fileName,
      kind: attachment.kind,
      sizeBytes: attachment.sizeBytes,
      textChars: attachment.textChars,
      truncated: attachment.truncated,
      createdAt: attachment.createdAt,
      usedAsSource: usedNames.has(attachment.fileName),
    })),
    evaluations,
    rounds: pairRoundEvaluations(
      rounds,
      evaluationRows,
      proposals.map((proposal) => ({ refinementRoundId: proposal.refinementRoundId, status: proposal.status, resolvedAt: proposal.resolvedAt })),
    ),
    roundProposals,
    impacts: limited(impactRows, REPORT_LIMITS.impacts),
    comparisons: limited(comparisonRows, REPORT_LIMITS.comparisons),
    llmSummary,
    proposalsTruncated,
  };
}
