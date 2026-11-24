import { toEvaluationExport, type EvaluationExport } from "@/lib/export/common";
import { exportText } from "@/lib/export/sanitize";
import { listEvaluationsForVariant } from "@/lib/db/evaluations";
import { getProject } from "@/lib/db/projects";
import { getVariantDetails } from "@/lib/db/variants";
import { BLOCK_INFO, BLOCK_KEYS, type BlockKey } from "@/lib/schemas/bmc";

export type CanvasBlockData = { blockKey: BlockKey; title: string; entries: string[] };

/** Dane eksportu płótna (PDF i DOCX): tylko zapisany stan wariantu i jego najnowsza ocena. Teksty już oczyszczone. */
export type CanvasExportData = {
  generatedAt: Date;
  projectName: string;
  variantName: string;
  variantVersion: number;
  blocks: CanvasBlockData[];
  evaluation: EvaluationExport | null;
  /** Najnowsza ocena istnieje, ale zapis jest nieczytelny (niezgodny ze schematem): dokument to zaznacza. */
  evaluationUnreadable: boolean;
};

/**
 * Składa dane eksportu płótna z bazy (0 wywołań modelu). Wszystkie odczyty ograniczone do projektu z uprawnień (wariant: do
 * projektu ORAZ wariantu). Zwraca null, gdy wariant nie należy do projektu.
 */
export async function loadCanvasExportData(projectId: string, variantId: string, now: Date): Promise<CanvasExportData | null> {
  const variant = await getVariantDetails(projectId, variantId);
  const project = variant ? await getProject(projectId) : null;
  if (!variant || !project) {
    return null;
  }
  const [latest] = await listEvaluationsForVariant(projectId, variantId, 1);

  return {
    generatedAt: now,
    projectName: exportText(project.name),
    variantName: exportText(variant.name),
    variantVersion: variant.version,
    blocks: BLOCK_KEYS.map((blockKey) => ({
      blockKey,
      title: BLOCK_INFO[blockKey].label,
      entries: variant.state[blockKey].map((entry) => exportText(entry)).filter((entry) => entry.length > 0),
    })),
    evaluation: latest?.ok ? toEvaluationExport(latest.evaluation, variant.version) : null,
    evaluationUnreadable: latest !== undefined && !latest.ok,
  };
}
