export type ExportFormat = "pdf" | "docx";
export type ExportKind = "plansza" | "raport";

/** Adres pobrania eksportu wariantu (route handler `/api/projekty/[id]/eksport`). Identyfikatory pochodzą z bazy. */
export function exportHref(projectId: string, variantId: string, format: ExportFormat, kind: ExportKind): string {
  const params = new URLSearchParams({ wariant: variantId, format, rodzaj: kind });
  return `/api/projekty/${encodeURIComponent(projectId)}/eksport?${params.toString()}`;
}
