import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDocx, buildPdf, buildZip } from "@/lib/attachments/build-test-files";
import { loadAttachmentLimits } from "@/lib/attachments/config";
import { createFileSystemStorage } from "@/lib/attachments/storage";

// Prawdziwe: uploadAttachment, createAttachment, countAttachments, ekstrakcja i magazyn na katalogu tymczasowym.
// Zamockowany jest wyłącznie klient Prisma (zasada z PR „P”: testy zapisu na prawdziwych funkcjach).
const world = vi.hoisted(() => ({ seq: 0, rows: [] as Array<{ id: string; projectId: string; ordinal: number }>, nextId: 1 }));

const m = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  txAttachment: { count: vi.fn(), create: vi.fn() },
  prismaAttachment: { count: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: { attachment: m.prismaAttachment, $transaction: m.transaction },
}));

import { uploadAttachment } from "@/lib/attachments/upload";

const tx = { $queryRaw: m.queryRaw, attachment: m.txAttachment };

let dir: string;
const text = (value: string) => new TextEncoder().encode(value);
const LONG_TEXT = "Kawiarnia Ziarno sprzedaje kawę speciality i ciasta w centrum miasta. Zażółć gęślą jaźń.";

function limits(overrides: Record<string, string> = {}) {
  return loadAttachmentLimits({ ATTACHMENTS_DIR: dir, ...overrides });
}

function filesInStorage(): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  dir = mkdtempSync(join(tmpdir(), "bmc-upload-"));
  world.seq = 0;
  world.rows = [];
  world.nextId = 1;

  m.prismaAttachment.count.mockImplementation(async () => world.rows.length);
  m.queryRaw.mockImplementation(async () => {
    world.seq += 1;
    return [{ attachmentSeq: world.seq }];
  });
  m.txAttachment.count.mockImplementation(async () => world.rows.length);
  m.txAttachment.create.mockImplementation(async (args: { data: Record<string, unknown> & { projectId: string; ordinal: number } }) => {
    const row = { id: `a${world.nextId++}`, projectId: args.data.projectId, ordinal: args.data.ordinal };
    world.rows.push(row);
    return {
      id: row.id,
      ordinal: row.ordinal,
      fileName: args.data.fileName,
      kind: args.data.kind,
      sizeBytes: args.data.sizeBytes,
      textChars: args.data.textChars,
      truncated: args.data.truncated,
      createdAt: new Date("2026-11-23T10:00:00Z"),
    };
  });
  m.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function upload(fileName: string, bytes: Uint8Array, overrides: Record<string, string> = {}) {
  const config = limits(overrides);
  return uploadAttachment(
    { projectId: "p1", userId: "u1", fileName, bytes },
    { limits: config, storage: createFileSystemStorage(config.storageDir) },
  );
}

describe("uploadAttachment: poprawne pliki", () => {
  it("TXT z polskimi znakami: zapisuje rekord i plik, numer Z1", async () => {
    const result = await upload("opis.txt", text(LONG_TEXT));

    expect(result).toMatchObject({ ok: true, attachment: { ordinal: 1, kind: "TXT", fileName: "opis.txt" } });
    const created = m.txAttachment.create.mock.calls[0][0].data;
    expect(created.extractedText).toContain("Zażółć gęślą jaźń");
    expect(created.projectId).toBe("p1");
    expect(created.createdById).toBe("u1");
    expect(filesInStorage()).toHaveLength(1);
    expect(created.storageKey).toBe(filesInStorage()[0]);
  });

  it("PDF z warstwą tekstową i DOCX z Worda przechodzą", async () => {
    const pdf = await upload("opis.pdf", buildPdf([LONG_TEXT.replace(/[^\x20-\x7E]/g, "")]));
    const docx = await upload("opis.docx", buildDocx([LONG_TEXT]));

    expect(pdf).toMatchObject({ ok: true, attachment: { kind: "PDF", ordinal: 1 } });
    expect(docx).toMatchObject({ ok: true, attachment: { kind: "DOCX", ordinal: 2 } });
    expect(filesInStorage()).toHaveLength(2);
  });

  it("nazwa pliku jest normalizowana (ścieżka, znaki sterujące) przed zapisem", async () => {
    await upload("../../x/‮opis\u0000.txt", text(LONG_TEXT));

    expect(m.txAttachment.create.mock.calls[0][0].data.fileName).toBe("opis .txt");
  });
});

describe("uploadAttachment: odrzucenia (nic nie jest zapisane)", () => {
  async function expectRejected(promise: ReturnType<typeof upload>, error: string) {
    const result = await promise;
    expect(result).toMatchObject({ ok: false, error });
    expect(m.txAttachment.create).not.toHaveBeenCalled();
    expect(m.queryRaw).not.toHaveBeenCalled();
    expect(filesInStorage()).toHaveLength(0);
    return result;
  }

  it("pusty plik", async () => {
    await expectRejected(upload("pusty.txt", new Uint8Array()), "EMPTY");
  });

  it("plik za duży (limit z konfiguracji)", async () => {
    const result = await expectRejected(upload("duzy.txt", text("a".repeat(2048)), { ATTACHMENT_MAX_BYTES: "1024" }), "TOO_LARGE");
    expect(result).toMatchObject({ message: expect.stringContaining("za duży") });
  });

  it("limit liczby załączników (sprawdzany przed ekstrakcją)", async () => {
    world.rows = [{ id: "a0", projectId: "p1", ordinal: 1 }];

    await expectRejected(upload("opis.txt", text(LONG_TEXT), { ATTACHMENT_MAX_PER_PROJECT: "1" }), "LIMIT");
  });

  it("tekst z rozszerzeniem .pdf (niezgodność typu)", async () => {
    await expectRejected(upload("opis.pdf", text(LONG_TEXT)), "MISMATCH");
  });

  it("nieobsługiwane rozszerzenie", async () => {
    await expectRejected(upload("opis.exe", text(LONG_TEXT)), "UNSUPPORTED");
  });

  it("skan PDF (strona bez warstwy tekstowej)", async () => {
    const result = await expectRejected(upload("skan.pdf", buildPdf([null])), "NO_TEXT");
    expect(result).toMatchObject({ message: expect.stringContaining("skan") });
  });

  it("uszkodzony PDF i ZIP niebędący DOCX", async () => {
    await expectRejected(upload("zly.pdf", text("%PDF-1.4\nto nie jest pdf")), "CORRUPT");
    await expectRejected(upload("zly.docx", buildZip([{ name: "a.txt", data: "x" }])), "UNSUPPORTED");
  });

  it("nazwa złożona z samych kropek", async () => {
    await expectRejected(upload("..", text(LONG_TEXT)), "INVALID_NAME");
  });
});

describe("uploadAttachment: sprzątanie po nieudanym zapisie rekordu", () => {
  it("limit rozstrzygnięty w transakcji (wyścig): plik usunięty, rekordu brak, licznik nie rośnie", async () => {
    // Wstępne sprawdzenie widzi wolne miejsce, a transakcja już nie (drugie równoległe wgranie).
    m.prismaAttachment.count.mockResolvedValue(0);
    m.txAttachment.count.mockResolvedValue(1);
    m.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
      const before = world.seq;
      try {
        return await callback(tx);
      } catch (error) {
        world.seq = before;
        throw error;
      }
    });

    const result = await upload("opis.txt", text(LONG_TEXT), { ATTACHMENT_MAX_PER_PROJECT: "1" });

    expect(result).toMatchObject({ ok: false, error: "LIMIT" });
    expect(m.txAttachment.create).not.toHaveBeenCalled();
    expect(world.seq).toBe(0);
    expect(filesInStorage()).toHaveLength(0);
  });

  it("kolizja unikalności (P2002): plik usunięty, wynik CONFLICT", async () => {
    m.txAttachment.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));

    const result = await upload("opis.txt", text(LONG_TEXT));

    expect(result).toMatchObject({ ok: false, error: "CONFLICT" });
    expect(filesInStorage()).toHaveLength(0);
  });

  it("nieoczekiwany błąd bazy: plik usunięty, wyjątek propagowany", async () => {
    m.txAttachment.create.mockRejectedValue(new Error("baza niedostępna"));

    await expect(upload("opis.txt", text(LONG_TEXT))).rejects.toThrow("baza niedostępna");
    expect(filesInStorage()).toHaveLength(0);
  });

  it("projekt nie istnieje (UPDATE bez wiersza): plik usunięty, NOT_FOUND", async () => {
    m.queryRaw.mockResolvedValue([]);

    const result = await upload("opis.txt", text(LONG_TEXT));

    expect(result).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(filesInStorage()).toHaveLength(0);
  });
});
