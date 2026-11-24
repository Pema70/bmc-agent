import { z } from "zod";
import { getProjectAccess } from "@/lib/auth/permissions";
import { loadCanvasExportData } from "@/lib/export/canvas-data";
import { buildCanvasDocx } from "@/lib/export/docx/canvas-document";
import { buildReportDocx } from "@/lib/export/docx/report-document";
import { renderCanvasPdf, renderReportPdf } from "@/lib/export/pdf/render";
import { buildReportExport } from "@/lib/export/report-export";
import { exportContentDisposition } from "@/lib/export/sanitize";
import { loadReportData } from "@/lib/report/load-report-data";
import { VariantId } from "@/lib/schemas/bmc";

// Rodzaj „plansza” (9d): płótno BMC w PDF, wersja tekstowa w DOCX. Rodzaj „raport” (9e): rozszerzony raport ze źródłami.
const ExportQuery = z.strictObject({
  wariant: VariantId,
  format: z.enum(["pdf", "docx"]),
  rodzaj: z.enum(["plansza", "raport"]),
});

const CONTENT_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

function jsonError(status: number, error: string, message: string): Response {
  return Response.json({ error, message }, { status });
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;

  // 1. Sesja i rola VIEWER (każdy członek projektu) przed jakimkolwiek odczytem danych projektu.
  const access = await getProjectAccess(id, "VIEWER");
  if (!access.ok) {
    if (access.error === "UNAUTHENTICATED") {
      return jsonError(401, "UNAUTHENTICATED", "Zaloguj się, aby pobrać eksport.");
    }
    if (access.error === "FORBIDDEN") {
      return jsonError(403, "FORBIDDEN", "Nie masz uprawnień do eksportu w tym projekcie.");
    }
    return jsonError(404, "NOT_FOUND", "Nie znaleziono projektu.");
  }

  // 2. Parametry zapytania (strict: nic innego nie trafia do dokumentu). Bez `rodzaj` domyślnie „plansza”.
  const query = new URL(req.url).searchParams;
  const parsed = ExportQuery.safeParse({
    wariant: query.get("wariant") ?? undefined,
    format: query.get("format") ?? undefined,
    rodzaj: query.get("rodzaj") ?? "plansza",
  });
  if (!parsed.success || [...query.keys()].some((key) => key !== "wariant" && key !== "format" && key !== "rodzaj")) {
    return jsonError(400, "VALIDATION", "Nieprawidłowe parametry eksportu.");
  }

  // 3. Dane tylko z projektu z uprawnień (obcy lub nieistniejący wariant: 404 bez ujawniania). Zapisany stan, 0 wywołań modelu.
  const now = new Date();
  const { format, rodzaj } = parsed.data;
  let body: Uint8Array;
  let names: string[];
  if (rodzaj === "raport") {
    const report = await loadReportData(access.projectId, parsed.data.wariant, now);
    if (!report) {
      return jsonError(404, "NOT_FOUND", "Nie znaleziono tego wariantu w projekcie.");
    }
    const exportData = buildReportExport(report);
    body = format === "pdf" ? await renderReportPdf(exportData) : await buildReportDocx(exportData);
    names = [exportData.projectName, exportData.variantName, "raport"];
  } else {
    const data = await loadCanvasExportData(access.projectId, parsed.data.wariant, now);
    if (!data) {
      return jsonError(404, "NOT_FOUND", "Nie znaleziono tego wariantu w projekcie.");
    }
    body = format === "pdf" ? await renderCanvasPdf(data) : await buildCanvasDocx(data);
    names = [data.projectName, data.variantName];
  }

  return new Response(body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPES[format],
      "Content-Disposition": exportContentDisposition(names, now, format),
      "Content-Length": String(body.byteLength),
      // Dokument zawiera dane projektu: bez buforowania w przeglądarce i pośrednikach.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
