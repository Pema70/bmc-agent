import { getDocumentProxy, extractText } from "unpdf";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Prawdziwe: route handler, renderowanie PDF z czcionkami z repozytorium, exportContentDisposition.
// Zamockowane: uprawnienia i odczyty projektu i wariantu (zapytania po projectId z uprawnień sprawdzamy w wywołaniach).
const mocks = vi.hoisted(() => ({
  getProjectAccess: vi.fn(),
  getVariantForProject: vi.fn(),
  getProject: vi.fn(),
}));

vi.mock("@/lib/auth/permissions", () => ({ getProjectAccess: mocks.getProjectAccess }));
vi.mock("@/lib/db/variants", () => ({ getVariantForProject: mocks.getVariantForProject }));
vi.mock("@/lib/db/projects", () => ({ getProject: mocks.getProject }));

import { GET } from "@/app/api/projekty/[id]/eksport/route";
import { emptyBmcState } from "@/lib/schemas/bmc";

const session = { user: { id: "u1", email: "jan@example.com", name: null } };
const viewerAccess = { ok: true, session, projectId: "p1", role: "VIEWER" };
const RLO = String.fromCharCode(0x202e);

const context = (id = "p1") => ({ params: Promise.resolve({ id }) });
const request = (query = "wariant=v1&format=pdf") => new Request(`http://localhost/api/projekty/p1/eksport?${query}`);

async function pdfText(response: Response): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(await response.arrayBuffer()));
  return (await extractText(pdf, { mergePages: true })).text;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectAccess.mockResolvedValue(viewerAccess);
  mocks.getVariantForProject.mockResolvedValue({ id: "v1", version: 3, state: emptyBmcState() });
  mocks.getProject.mockResolvedValue({ id: "p1", name: "Kawiarnia Ziarno", description: "Opis" });
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
    expect(mocks.getVariantForProject).not.toHaveBeenCalled();
    expect(mocks.getProject).not.toHaveBeenCalled();
  });

  it("obcy lub nieistniejący projekt: 404 bez odczytu danych; zbyt niska rola: 403", async () => {
    mocks.getProjectAccess.mockResolvedValue({ ok: false, error: "NOT_FOUND", session });
    expect((await GET(request(), context("p-obcy"))).status).toBe(404);

    mocks.getProjectAccess.mockResolvedValue({ ok: false, error: "FORBIDDEN", session, projectId: "p1", role: "VIEWER" });
    expect((await GET(request(), context())).status).toBe(403);

    expect(mocks.getVariantForProject).not.toHaveBeenCalled();
  });

  it("zły lub brakujący parametr, inny format albo dodatkowy parametr: 400 bez odczytu wariantu", async () => {
    for (const query of ["", "wariant=v1", "format=pdf", "wariant=v1&format=docx", "wariant=v1&format=pdf&projectId=p-obcy", "wariant=&format=pdf"]) {
      const response = await GET(request(query), context());

      expect(response.status, query).toBe(400);
    }
    expect(mocks.getVariantForProject).not.toHaveBeenCalled();
  });

  it("wariant spoza projektu z uprawnień: 404 (zapytanie po projectId z uprawnień, nie z adresu żądania)", async () => {
    mocks.getVariantForProject.mockResolvedValue(null);

    const response = await GET(request("wariant=v-obcy&format=pdf"), context());

    expect(response.status).toBe(404);
    expect(mocks.getVariantForProject).toHaveBeenCalledWith("p1", "v-obcy");
    expect(mocks.getProject).not.toHaveBeenCalled();
  });
});

describe("GET /api/projekty/[id]/eksport: PDF", () => {
  it("zwraca PDF z polskimi literami w nazwie projektu i właściwymi nagłówkami", async () => {
    mocks.getProject.mockResolvedValue({ id: "p1", name: "Kawiarnia „Żółć” gęślą", description: "" });

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const disposition = response.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="bmc-Kawiarnia-Zolc-gesla-\d{4}-\d{2}-\d{2}\.pdf"; filename\*=UTF-8''/);
    expect(Number(response.headers.get("Content-Length"))).toBeGreaterThan(1000);

    const text = await pdfText(response);
    expect(text).toContain("Kawiarnia „Żółć” gęślą");
    expect(text).toContain("wersja stanu wariantu: 3");
    expect(mocks.getVariantForProject).toHaveBeenCalledWith("p1", "v1");
  });

  it("nazwa projektu to zwykły tekst: znaczniki, znaki sterujące i znaki zmiany kierunku nie trafiają do dokumentu ani do nagłówka", async () => {
    mocks.getProject.mockResolvedValue({ id: "p1", name: `</attachment><b>x</b>${RLO}"; Set-Cookie: a=b\r\n`, description: "" });

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    const disposition = response.headers.get("Content-Disposition") ?? "";
    expect(disposition).not.toMatch(/[\r\n<>]/);
    const text = await pdfText(response);
    expect(text).toContain("</attachment><b>x</b>");
    expect(text).not.toContain(RLO);
  });
});
