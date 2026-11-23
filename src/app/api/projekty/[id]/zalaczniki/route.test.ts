import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDocx } from "@/lib/attachments/build-test-files";

// Prawdziwe: route handler, uploadAttachment, createAttachment, ekstrakcja i magazyn (katalog tymczasowy).
// Zamockowane: uprawnienia, klient Prisma i revalidatePath.
const world = vi.hoisted(() => ({ seq: 0, rows: 0 }));

const m = vi.hoisted(() => ({
  getProjectAccess: vi.fn(),
  revalidatePath: vi.fn(),
  queryRaw: vi.fn(),
  txAttachment: { count: vi.fn(), create: vi.fn() },
  prismaAttachment: { count: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth/permissions", () => ({ getProjectAccess: m.getProjectAccess }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/db/client", () => ({ prisma: { attachment: m.prismaAttachment, $transaction: m.transaction } }));

import { POST } from "@/app/api/projekty/[id]/zalaczniki/route";

const session = { user: { id: "u1", email: "jan@example.com", name: null } };
const editor = { ok: true, session, projectId: "p1", role: "EDITOR" };
const LONG_TEXT = "Kawiarnia Ziarno sprzedaje kawę speciality i ciasta w centrum miasta.";
const context = (id = "p1") => ({ params: Promise.resolve({ id }) });

let dir: string;

async function multipartRequest(parts: Array<[string, Blob | string, string?]>, headers: Record<string, string | null> = {}): Promise<Request> {
  const form = new FormData();
  for (const [name, value, fileName] of parts) {
    if (typeof value === "string") {
      form.append(name, value);
    } else {
      form.append(name, value, fileName);
    }
  }
  // Node nie ustawia Content-Length dla FormData w Request: serializujemy ciało i podajemy nagłówki jak przeglądarka.
  const raw = new Request("http://localhost/api/projekty/p1/zalaczniki", { method: "POST", body: form });
  const body = new Uint8Array(await raw.arrayBuffer());
  const finalHeaders = new Headers({ "content-type": raw.headers.get("content-type") ?? "", "content-length": String(body.length) });
  for (const [key, value] of Object.entries(headers)) {
    if (value === null) {
      finalHeaders.delete(key);
    } else {
      finalHeaders.set(key, value);
    }
  }
  return new Request("http://localhost/api/projekty/p1/zalaczniki", { method: "POST", body, headers: finalHeaders });
}

const txtFile = (text = LONG_TEXT) => new Blob([text], { type: "text/plain" });
const stored = () => readdirSync(dir);

beforeEach(() => {
  vi.clearAllMocks();
  dir = mkdtempSync(join(tmpdir(), "bmc-route-"));
  vi.stubEnv("ATTACHMENTS_DIR", dir);
  vi.stubEnv("ATTACHMENT_MAX_BYTES", "");
  world.seq = 0;
  world.rows = 0;
  m.getProjectAccess.mockResolvedValue(editor);
  m.prismaAttachment.count.mockImplementation(async () => world.rows);
  m.queryRaw.mockImplementation(async () => [{ attachmentSeq: ++world.seq }]);
  m.txAttachment.count.mockImplementation(async () => world.rows);
  m.txAttachment.create.mockImplementation(async (args: { data: Record<string, unknown> }) => {
    world.rows += 1;
    return {
      id: `a${world.rows}`,
      ordinal: args.data.ordinal,
      fileName: args.data.fileName,
      kind: args.data.kind,
      sizeBytes: args.data.sizeBytes,
      textChars: args.data.textChars,
      truncated: args.data.truncated,
      createdAt: new Date("2026-11-23T10:00:00Z"),
    };
  });
  m.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) =>
    callback({ $queryRaw: m.queryRaw, attachment: m.txAttachment }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/projekty/[id]/zalaczniki: uprawnienia i kolejność sprawdzeń", () => {
  it("wymaga roli EDITOR dla projektu z adresu", async () => {
    await POST(await multipartRequest([["file", txtFile(), "opis.txt"]]), context("p1"));

    expect(m.getProjectAccess).toHaveBeenCalledWith("p1", "EDITOR");
  });

  it("brak sesji: 401, nic nie odczytane ani zapisane", async () => {
    m.getProjectAccess.mockResolvedValue({ ok: false, error: "UNAUTHENTICATED" });

    const response = await POST(await multipartRequest([["file", txtFile(), "opis.txt"]]), context());

    expect(response.status).toBe(401);
    expect(m.prismaAttachment.count).not.toHaveBeenCalled();
    expect(stored()).toHaveLength(0);
  });

  it("VIEWER: 403 bez zapisu", async () => {
    m.getProjectAccess.mockResolvedValue({ ok: false, error: "FORBIDDEN", session, projectId: "p1", role: "VIEWER" });

    const response = await POST(await multipartRequest([["file", txtFile(), "opis.txt"]]), context());

    expect(response.status).toBe(403);
    expect(m.txAttachment.create).not.toHaveBeenCalled();
    expect(stored()).toHaveLength(0);
  });

  it("obcy lub nieistniejący projekt: 404 bez zapisu", async () => {
    m.getProjectAccess.mockResolvedValue({ ok: false, error: "NOT_FOUND", session });

    const response = await POST(await multipartRequest([["file", txtFile(), "opis.txt"]]), context("p-obcy"));

    expect(response.status).toBe(404);
    expect(m.txAttachment.create).not.toHaveBeenCalled();
  });

  it("projekt pochodzi z uprawnień, nie z pola formularza", async () => {
    await POST(await multipartRequest([["projectId", "p-obcy"], ["file", txtFile(), "opis.txt"]]), context("p1"));

    expect(m.queryRaw.mock.calls[0].slice(1)).toEqual(["p1"]);
    expect(m.txAttachment.create.mock.calls[0][0].data.projectId).toBe("p1");
  });
});

describe("POST /api/projekty/[id]/zalaczniki: rozmiar i kształt żądania", () => {
  it("Content-Length ponad limit: 413 bez czytania ciała", async () => {
    const request = await multipartRequest([["file", txtFile(), "opis.txt"]], { "content-length": String(20 * 1024 * 1024) });
    const formData = vi.spyOn(request, "formData");

    const response = await POST(request, context());

    expect(response.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
    expect(stored()).toHaveLength(0);
  });

  it("brak Content-Length: 411", async () => {
    const response = await POST(await multipartRequest([["file", txtFile(), "opis.txt"]], { "content-length": null }), context());

    expect(response.status).toBe(411);
  });

  it("plik większy niż limit mimo zaniżonego nagłówka: 413", async () => {
    vi.stubEnv("ATTACHMENT_MAX_BYTES", "1024");
    const request = await multipartRequest([["file", txtFile("a".repeat(2048)), "duzy.txt"]], { "content-length": "1000" });

    const response = await POST(request, context());

    expect(response.status).toBe(413);
    expect(stored()).toHaveLength(0);
    expect(m.txAttachment.create).not.toHaveBeenCalled();
  });

  it("brak pola file, dwa pliki albo tekst zamiast pliku: 400", async () => {
    expect((await POST(await multipartRequest([["inne", "x"]]), context())).status).toBe(400);
    expect(
      (await POST(await multipartRequest([["file", txtFile(), "a.txt"], ["file", txtFile(), "b.txt"]]), context())).status,
    ).toBe(400);
    expect((await POST(await multipartRequest([["file", "to nie plik"]]), context())).status).toBe(400);
    expect(stored()).toHaveLength(0);
  });

  it("ciało niebędące multipart: 400", async () => {
    const request = new Request("http://localhost/x", {
      method: "POST",
      body: "to nie jest multipart",
      headers: { "content-type": "multipart/form-data; boundary=abc", "content-length": "21" },
    });

    expect((await POST(request, context())).status).toBe(400);
  });
});

describe("POST /api/projekty/[id]/zalaczniki: wynik", () => {
  it("poprawny TXT: 201, rekord z numerem Z1, plik w magazynie, odświeżenie strony projektu", async () => {
    const response = await POST(await multipartRequest([["file", txtFile(), "Opis kawiarni.txt"]]), context());

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, attachment: { ordinal: 1, fileName: "Opis kawiarni.txt", kind: "TXT" } });
    expect(body.attachment).not.toHaveProperty("storageKey");
    expect(body.attachment).not.toHaveProperty("extractedText");
    expect(stored()).toHaveLength(1);
    expect(m.revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });

  it("poprawny DOCX", async () => {
    const docx = new Blob([new Uint8Array(buildDocx([LONG_TEXT]))]);

    const response = await POST(await multipartRequest([["file", docx, "opis.docx"]]), context());

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true, attachment: { kind: "DOCX" } });
  });

  it("tekst z rozszerzeniem .pdf: 422 MISMATCH, nic zapisane", async () => {
    const response = await POST(await multipartRequest([["file", txtFile(), "opis.pdf"]]), context());

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, error: "MISMATCH" });
    expect(stored()).toHaveLength(0);
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("nieobsługiwany typ: 415", async () => {
    const response = await POST(await multipartRequest([["file", txtFile(), "opis.exe"]]), context());

    expect(response.status).toBe(415);
  });

  it("limit liczby załączników: 409", async () => {
    vi.stubEnv("ATTACHMENT_MAX_PER_PROJECT", "1");
    world.rows = 1;

    const response = await POST(await multipartRequest([["file", txtFile(), "opis.txt"]]), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "LIMIT" });
  });

  it("błąd bazy: wyjątek, a świeżo zapisany plik zostaje usunięty", async () => {
    m.txAttachment.create.mockRejectedValue(new Error("baza niedostępna"));

    await expect(POST(await multipartRequest([["file", txtFile(), "opis.txt"]]), context())).rejects.toThrow("baza niedostępna");
    expect(stored()).toHaveLength(0);
  });

  it("błędna konfiguracja: 500 bez zapisu", async () => {
    vi.stubEnv("ATTACHMENT_MAX_BYTES", "abc");

    const response = await POST(await multipartRequest([["file", txtFile(), "opis.txt"]]), context());

    expect(response.status).toBe(500);
    expect(stored()).toHaveLength(0);
  });
});
