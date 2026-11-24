import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Prawdziwe: route handler, loadCanvasExportData, generowanie PDF i DOCX z czcionkami z repozytorium, nazwa pliku.
// Zamockowane: uprawnienia i odczyty z bazy (zapytania po projectId z uprawnień sprawdzamy w wywołaniach).
const mocks = vi.hoisted(() => ({
  getProjectAccess: vi.fn(),
  getVariantDetails: vi.fn(),
  getProject: vi.fn(),
  listEvaluationsForVariant: vi.fn(),
  loadReportData: vi.fn(),
}));

vi.mock("@/lib/auth/permissions", () => ({ getProjectAccess: mocks.getProjectAccess }));
vi.mock("@/lib/db/variants", () => ({ getVariantDetails: mocks.getVariantDetails }));
vi.mock("@/lib/db/projects", () => ({ getProject: mocks.getProject }));
vi.mock("@/lib/db/evaluations", () => ({ listEvaluationsForVariant: mocks.listEvaluationsForVariant }));
// Składanie danych raportu ma własne testy (load-report-data.test.ts, z prawdziwymi funkcjami odczytu); tu sprawdzamy route.
vi.mock("@/lib/report/load-report-data", () => ({ loadReportData: mocks.loadReportData }));

import { GET } from "@/app/api/projekty/[id]/eksport/route";
import { reportData } from "@/lib/export/report-fixtures";
import { evaluationView } from "@/lib/export/test-fixtures";
import { emptyBmcState } from "@/lib/schemas/bmc";

const session = { user: { id: "u1", email: "jan@example.com", name: null } };
const viewerAccess = { ok: true, session, projectId: "p1", role: "VIEWER" };
const RLO = String.fromCharCode(0x202e);
const PDF_TYPE = "application/pdf";
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const context = (id = "p1") => ({ params: Promise.resolve({ id }) });
const request = (query = "wariant=v1&format=pdf&rodzaj=plansza") => new Request(`http://localhost/api/projekty/p1/eksport?${query}`);

async function pdfText(response: Response): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(await response.arrayBuffer()));
  return (await extractText(pdf, { mergePages: true })).text;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectAccess.mockResolvedValue(viewerAccess);
  mocks.getVariantDetails.mockResolvedValue({
    id: "v1",
    name: "Wariant główny",
    isMain: true,
    origin: "MANUAL",
    description: null,
    version: 3,
    createdAt: new Date("2026-11-01T10:00:00Z"),
    updatedAt: new Date("2026-11-02T10:00:00Z"),
    state: { ...emptyBmcState(), channels: ["Sklep online"] },
  });
  mocks.getProject.mockResolvedValue({ id: "p1", name: "Kawiarnia Ziarno", description: "Opis" });
  mocks.listEvaluationsForVariant.mockResolvedValue([{ ok: true, evaluation: evaluationView() }]);
});

describe("GET /api/projekty/[id]/eksport: uprawnienia i kolejność sprawdzeń", () => {
  it("wymaga roli VIEWER (każdy członek projektu) dla projektu z adresu", async () => {
    await GET(request(), context("p1"));

    expect(mocks.getProjectAccess).toHaveBeenCalledWith("p1", "VIEWER");
  });

  it("brak sesji: 401 bez odczytu danych", async () => {
    mocks.getProjectAccess.mockResolvedValue({ ok: false, error: "UNAUTHENTICATED" });

    const response = await GET(request(), context());

    expect(response.status).toBe(401);
    expect(mocks.getVariantDetails).not.toHaveBeenCalled();
    expect(mocks.getProject).not.toHaveBeenCalled();
  });

  it("obcy lub nieistniejący projekt: 404 bez odczytu danych; brak uprawnień: 403", async () => {
    mocks.getProjectAccess.mockResolvedValue({ ok: false, error: "NOT_FOUND", session });
    expect((await GET(request(), context("p-obcy"))).status).toBe(404);

    mocks.getProjectAccess.mockResolvedValue({ ok: false, error: "FORBIDDEN", session, projectId: "p1", role: "VIEWER" });
    expect((await GET(request(), context())).status).toBe(403);

    expect(mocks.getVariantDetails).not.toHaveBeenCalled();
  });

  it("zły lub brakujący parametr, nieznany format lub rodzaj, dodatkowy parametr: 400 bez odczytu wariantu", async () => {
    const bad = [
      "",
      "wariant=v1",
      "format=pdf",
      "wariant=&format=pdf",
      "wariant=v1&format=txt",
      "wariant=v1&format=pdf&rodzaj=inne",
      "wariant=v1&format=pdf&projectId=p-obcy",
    ];
    for (const query of bad) {
      expect((await GET(request(query), context())).status, query).toBe(400);
    }
    expect(mocks.getVariantDetails).not.toHaveBeenCalled();
  });

  it("wariant spoza projektu z uprawnień: 404 (zapytanie po projectId z uprawnień, nie z adresu żądania)", async () => {
    mocks.getVariantDetails.mockResolvedValue(null);

    const response = await GET(request("wariant=v-obcy&format=pdf&rodzaj=plansza"), context("p-z-adresu"));

    expect(response.status).toBe(404);
    expect(mocks.getVariantDetails).toHaveBeenCalledWith("p1", "v-obcy");
    expect(mocks.getProject).not.toHaveBeenCalled();
  });

  it("bez parametru rodzaj domyślnie „plansza”", async () => {
    expect((await GET(request("wariant=v1&format=docx"), context())).status).toBe(200);
  });
});

describe("GET /api/projekty/[id]/eksport: PDF", () => {
  it("zwraca PDF z polskimi literami i właściwymi nagłówkami, z danych zapisanego stanu", async () => {
    mocks.getProject.mockResolvedValue({ id: "p1", name: "Kawiarnia „Żółć” gęślą", description: "" });

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(PDF_TYPE);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="bmc-Kawiarnia-Zolc-gesla-Wariant-glowny-\d{4}-\d{2}-\d{2}\.pdf"; filename\*=UTF-8''/,
    );
    expect(Number(response.headers.get("Content-Length"))).toBeGreaterThan(1000);
    const text = await pdfText(response);
    expect(text).toContain("Kawiarnia „Żółć” gęślą");
    expect(text).toContain("Wersja zapisanego stanu: 3");
    expect(text).toContain("Sklep online");
    expect(mocks.listEvaluationsForVariant).toHaveBeenCalledWith("p1", "v1", 1);
  });

  it("nazwa projektu to zwykły tekst: znaczniki, znaki sterujące i zmiany kierunku nie trafiają do dokumentu ani do nagłówka", async () => {
    mocks.getProject.mockResolvedValue({ id: "p1", name: `</attachment><b>x</b>${RLO}"; Set-Cookie: a=b\r\n`, description: "" });

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition") ?? "").not.toMatch(/[\r\n<>]/);
    const text = await pdfText(response);
    expect(text.replace(/\s+/g, "")).toContain("</attachment><b>x</b>");
    expect(text).not.toContain(RLO);
  });

  it("nieczytelna najnowsza ocena nie psuje eksportu: dokument ma komunikat", async () => {
    mocks.listEvaluationsForVariant.mockResolvedValue([{ ok: false, id: "e1", error: "x" }]);

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(await pdfText(response)).toContain("jest nieczytelna");
  });
});

describe("GET /api/projekty/[id]/eksport: DOCX", () => {
  it("zwraca DOCX z właściwym typem, nazwą pliku i treścią zapisanego stanu", async () => {
    const response = await GET(request("wariant=v1&format=docx&rodzaj=plansza"), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(DOCX_TYPE);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Disposition")).toMatch(/filename="bmc-Kawiarnia-Ziarno-Wariant-glowny-\d{4}-\d{2}-\d{2}\.docx"/);
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(Number(response.headers.get("Content-Length"))).toBe(buffer.byteLength);
    const html = (await mammoth.convertToHtml({ buffer })).value;
    expect(html).toContain("<h1>Kawiarnia Ziarno</h1>");
    expect(html).toContain("<li>Sklep online</li>");
  });

  it("eksport nie wywołuje modelu: brak jakichkolwiek zapisów, tylko odczyty (mock udostępnia wyłącznie funkcje odczytu)", async () => {
    await GET(request("wariant=v1&format=docx&rodzaj=plansza"), context());

    expect(mocks.getVariantDetails).toHaveBeenCalledTimes(1);
    expect(mocks.listEvaluationsForVariant).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/projekty/[id]/eksport: rodzaj „raport”", () => {
  beforeEach(() => {
    mocks.loadReportData.mockResolvedValue(reportData());
  });

  it("odczyt danych raportu po projekcie z uprawnień i wariancie z zapytania; bez odczytu danych płótna", async () => {
    const response = await GET(request("wariant=v1&format=pdf&rodzaj=raport"), context("p-z-adresu"));

    expect(response.status).toBe(200);
    expect(mocks.loadReportData).toHaveBeenCalledWith("p1", "v1", expect.any(Date));
    expect(mocks.getVariantDetails).not.toHaveBeenCalled();
  });

  it("PDF raportu: typ, nagłówki bezpieczeństwa i nazwa pliku z członem „raport”", async () => {
    const response = await GET(request("wariant=v1&format=pdf&rodzaj=raport"), context());

    expect(response.headers.get("Content-Type")).toBe(PDF_TYPE);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Disposition")).toMatch(/filename="bmc-Kawiarnia-Ziarno-Wariant-glowny-raport-\d{4}-\d{2}-\d{2}\.pdf"/);
    expect(await pdfText(response)).toContain("Raport wariantu modelu biznesowego");
  });

  it("DOCX raportu: typ i treść z kodami źródeł", async () => {
    const response = await GET(request("wariant=v1&format=docx&rodzaj=raport"), context());

    expect(response.headers.get("Content-Type")).toBe(DOCX_TYPE);
    const buffer = Buffer.from(await response.arrayBuffer());
    expect((await mammoth.extractRawText({ buffer })).value).toContain("[W] Kawa ekologiczna");
  });

  it("wariant spoza projektu: 404", async () => {
    mocks.loadReportData.mockResolvedValue(null);

    expect((await GET(request("wariant=v-obcy&format=pdf&rodzaj=raport"), context())).status).toBe(404);
  });

  it("brak sesji i obcy projekt: bez odczytu danych raportu", async () => {
    mocks.getProjectAccess.mockResolvedValue({ ok: false, error: "UNAUTHENTICATED" });
    expect((await GET(request("wariant=v1&format=pdf&rodzaj=raport"), context())).status).toBe(401);
    mocks.getProjectAccess.mockResolvedValue({ ok: false, error: "NOT_FOUND", session });
    expect((await GET(request("wariant=v1&format=pdf&rodzaj=raport"), context())).status).toBe(404);

    expect(mocks.loadReportData).not.toHaveBeenCalled();
  });
});
