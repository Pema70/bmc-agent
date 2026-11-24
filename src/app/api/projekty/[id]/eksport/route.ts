import { z } from "zod";
import { getProjectAccess } from "@/lib/auth/permissions";
import { getProject } from "@/lib/db/projects";
import { getVariantForProject } from "@/lib/db/variants";
import { exportContentDisposition } from "@/lib/export/sanitize";
import { renderSamplePdf } from "@/lib/export/pdf/render";
import { VariantId } from "@/lib/schemas/bmc";

// PR 9b: tylko próbny PDF (format=pdf), żeby sprawdzić zgodność z Next 16 i Turbopackiem oraz polskie litery. Format DOCX
// i rodzaje „plansza” i „raport” dochodzą w 9d i 9e (ten sam adres, rozszerzony `ExportQuery`).
const ExportQuery = z.strictObject({
  wariant: VariantId,
  format: z.literal("pdf"),
});

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

  // 2. Parametry zapytania (strict: nic innego nie trafia do dokumentu).
  const query = new URL(req.url).searchParams;
  const parsed = ExportQuery.safeParse({ wariant: query.get("wariant") ?? undefined, format: query.get("format") ?? undefined });
  if (!parsed.success || [...query.keys()].some((key) => key !== "wariant" && key !== "format")) {
    return jsonError(400, "VALIDATION", "Nieprawidłowe parametry eksportu.");
  }

  // 3. Wariant i projekt tylko z projektu z uprawnień (obcy lub nieistniejący: 404 bez ujawniania).
  const variant = await getVariantForProject(access.projectId, parsed.data.wariant);
  const project = variant ? await getProject(access.projectId) : null;
  if (!variant || !project) {
    return jsonError(404, "NOT_FOUND", "Nie znaleziono tego wariantu w projekcie.");
  }

  const now = new Date();
  const pdf = await renderSamplePdf({
    projectName: project.name,
    variantVersion: variant.version,
    generatedAt: new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw" }).format(now),
  });

  return new Response(pdf as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": exportContentDisposition([project.name], now, "pdf"),
      "Content-Length": String(pdf.byteLength),
      // Dokument zawiera dane projektu: bez buforowania w przeglądarce i pośrednikach.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
