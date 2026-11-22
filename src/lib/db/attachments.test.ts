import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; projectId: string; ordinal: number };

// Prosty „świat” bazy: licznik projektu i załączniki. Transakcja robi migawkę i przy wyjątku ją przywraca,
// więc testy sprawdzają realne skutki wycofania (np. licznik nie rośnie przy przekroczeniu limitu).
const world = vi.hoisted(() => ({ seq: 0, rows: [] as Array<{ id: string; projectId: string; ordinal: number }>, nextId: 1 }));

const m = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  txAttachment: { count: vi.fn(), create: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn() },
  txProject: { update: vi.fn() },
  prismaAttachment: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: { attachment: m.prismaAttachment, project: m.txProject, $transaction: m.transaction },
}));

import {
  countAttachments,
  createAttachment,
  deleteAttachment,
  getAttachmentByOrdinal,
  getAttachmentForProject,
  listAttachmentsForProject,
} from "@/lib/db/attachments";

const tx = { $queryRaw: m.queryRaw, attachment: m.txAttachment, project: m.txProject };

const input = {
  projectId: "p1",
  createdById: "u1",
  fileName: "../../Opis kawiarni.pdf",
  kind: "PDF" as const,
  sizeBytes: 2048,
  storageKey: "K".repeat(32),
  extractedText: "Kawiarnia w centrum miasta.",
  truncated: false,
};

function viewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    ordinal: 1,
    fileName: "Opis kawiarni.pdf",
    kind: "PDF",
    sizeBytes: 2048,
    textChars: 27,
    truncated: false,
    createdAt: new Date("2026-11-22T10:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  world.seq = 0;
  world.rows = [];
  world.nextId = 1;

  m.queryRaw.mockImplementation(async () => {
    world.seq += 1;
    return [{ attachmentSeq: world.seq }];
  });
  m.txAttachment.count.mockImplementation(async () => world.rows.length);
  m.txAttachment.create.mockImplementation(async (args: { data: { projectId: string; ordinal: number } & Record<string, unknown> }) => {
    const row: Row = { id: `a${world.nextId++}`, projectId: args.data.projectId, ordinal: args.data.ordinal };
    world.rows.push(row);
    return viewRow({ id: row.id, ordinal: row.ordinal, fileName: args.data.fileName, textChars: args.data.textChars });
  });
  m.txAttachment.findFirst.mockImplementation(async (args: { where: { id: string; projectId: string } }) => {
    const found = world.rows.find((r) => r.id === args.where.id && r.projectId === args.where.projectId);
    return found ? { storageKey: `klucz-${found.id}` } : null;
  });
  m.txAttachment.deleteMany.mockImplementation(async (args: { where: { id: string; projectId: string } }) => {
    const before = world.rows.length;
    world.rows = world.rows.filter((r) => !(r.id === args.where.id && r.projectId === args.where.projectId));
    return { count: before - world.rows.length };
  });
  m.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
    const snapshot = { seq: world.seq, rows: world.rows.map((r) => ({ ...r })), nextId: world.nextId };
    try {
      return await callback(tx);
    } catch (error) {
      world.seq = snapshot.seq;
      world.rows = snapshot.rows;
      world.nextId = snapshot.nextId;
      throw error;
    }
  });
});

describe("createAttachment: zapis i numeracja", () => {
  it("pierwszy załącznik w projekcie dostaje numer 1 (Z1)", async () => {
    const result = await createAttachment(input, 10);

    expect(result).toMatchObject({ ok: true, attachment: { ordinal: 1 } });
  });

  it("numer pochodzi z atomowego UPDATE … RETURNING na projekcie, wykonanego przed liczeniem i zapisem", async () => {
    await createAttachment(input, 10);

    expect(m.queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = m.queryRaw.mock.calls[0] as [string[], ...unknown[]];
    const sql = strings.join("?");
    expect(sql).toContain('UPDATE "Project" SET "attachmentSeq" = "attachmentSeq" + 1');
    expect(sql).toContain('RETURNING "attachmentSeq"');
    expect(values).toEqual(["p1"]);
    expect(m.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(m.txAttachment.count.mock.invocationCallOrder[0]);
    expect(m.txAttachment.count.mock.invocationCallOrder[0]).toBeLessThan(m.txAttachment.create.mock.invocationCallOrder[0]);
  });

  it("numer to wartość z licznika, a nie liczba ani maksimum istniejących rekordów", async () => {
    world.rows = [{ id: "a-stary", projectId: "p1", ordinal: 1 }];
    m.queryRaw.mockResolvedValue([{ attachmentSeq: 42 }]);

    const result = await createAttachment(input, 10);

    expect(result).toMatchObject({ ok: true, attachment: { ordinal: 42 } });
    expect(m.txAttachment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ordinal: 42 }) }));
  });

  it("usunięcie Z2, a potem nowy plik: dostaje Z3, nie Z2", async () => {
    const z1 = await createAttachment(input, 10);
    const z2 = await createAttachment({ ...input, storageKey: "L".repeat(32) }, 10);
    expect(z1).toMatchObject({ ok: true, attachment: { ordinal: 1 } });
    expect(z2).toMatchObject({ ok: true, attachment: { ordinal: 2 } });

    const deleted = await deleteAttachment("p1", z2.ok ? z2.attachment.id : "");
    expect(deleted.ok).toBe(true);

    const z3 = await createAttachment({ ...input, storageKey: "M".repeat(32) }, 10);
    expect(z3).toMatchObject({ ok: true, attachment: { ordinal: 3 } });
  });

  it("usunięcie załącznika z najwyższym numerem (Z3): kolejny dostaje Z4, nie Z3", async () => {
    const ids: string[] = [];
    for (const key of ["A", "B", "C"]) {
      const created = await createAttachment({ ...input, storageKey: key.repeat(32) }, 10);
      ids.push(created.ok ? created.attachment.id : "");
    }
    expect((await deleteAttachment("p1", ids[2])).ok).toBe(true);

    const next = await createAttachment({ ...input, storageKey: "D".repeat(32) }, 10);

    expect(next).toMatchObject({ ok: true, attachment: { ordinal: 4 } });
  });

  it("zapisuje znormalizowaną nazwę, długość tekstu i autora", async () => {
    await createAttachment({ ...input, fileName: "../../Opis kawiarni.pdf" }, 10);

    expect(m.txAttachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: "p1",
          fileName: "Opis kawiarni.pdf",
          kind: "PDF",
          sizeBytes: 2048,
          storageKey: "K".repeat(32),
          extractedText: "Kawiarnia w centrum miasta.",
          textChars: 27,
          truncated: false,
          createdById: "u1",
        }),
      }),
    );
  });

  it("nieistniejący projekt: NOT_FOUND bez liczenia i zapisu", async () => {
    m.queryRaw.mockResolvedValue([]);

    expect(await createAttachment(input, 10)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(m.txAttachment.count).not.toHaveBeenCalled();
    expect(m.txAttachment.create).not.toHaveBeenCalled();
  });

  it("przekroczony limit na projekt: LIMIT, brak zapisu i wycofany licznik", async () => {
    world.seq = 5;
    world.rows = Array.from({ length: 3 }, (_, i) => ({ id: `a${i}`, projectId: "p1", ordinal: i + 1 }));

    expect(await createAttachment(input, 3)).toEqual({ ok: false, error: "LIMIT" });

    expect(m.txAttachment.create).not.toHaveBeenCalled();
    expect(world.seq).toBe(5);
    expect(world.rows).toHaveLength(3);
  });

  it("dopuszcza załącznik tuż poniżej limitu", async () => {
    world.rows = Array.from({ length: 2 }, (_, i) => ({ id: `a${i}`, projectId: "p1", ordinal: i + 1 }));
    world.seq = 2;

    expect((await createAttachment(input, 3)).ok).toBe(true);
  });

  it("błąd zapisu rekordu wycofuje transakcję i licznik nie rośnie", async () => {
    m.txAttachment.create.mockRejectedValue(new Error("baza nie odpowiada"));

    await expect(createAttachment(input, 10)).rejects.toThrow("baza nie odpowiada");

    expect(world.seq).toBe(0);
  });

  it("kolizja unikalności (projectId, ordinal) lub storageKey to CONFLICT, a nie cichy zapis", async () => {
    m.txAttachment.create.mockRejectedValue({ code: "P2002" });

    expect(await createAttachment(input, 10)).toEqual({ ok: false, error: "CONFLICT" });
    expect(world.seq).toBe(0);
  });

  it("inne błędy bazy są propagowane", async () => {
    m.txAttachment.create.mockRejectedValue({ code: "P2003" });

    await expect(createAttachment(input, 10)).rejects.toEqual({ code: "P2003" });
  });

  it.each([
    ["pusty tekst", { extractedText: "" }],
    ["tekst z NUL", { extractedText: "a\u0000b" }],
    ["zły klucz magazynu", { storageKey: "../x" }],
    ["nazwa pusta po normalizacji", { fileName: ".." }],
  ])("niepoprawne dane (%s) rzucają wyjątek przed transakcją", async (_name, override) => {
    await expect(createAttachment({ ...input, ...override }, 10)).rejects.toThrow();

    expect(m.transaction).not.toHaveBeenCalled();
  });
});

describe("odczyty zawsze po projekcie", () => {
  it("lista filtruje po projekcie, sortuje po numerze i nie pobiera tekstu ani klucza magazynu", async () => {
    m.prismaAttachment.findMany.mockResolvedValue([viewRow({ ordinal: 1 }), viewRow({ id: "a2", ordinal: 2 })]);

    const list = await listAttachmentsForProject("p1");

    expect(list.map((a) => a.ordinal)).toEqual([1, 2]);
    const args = m.prismaAttachment.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ projectId: "p1" });
    expect(args.orderBy).toEqual({ ordinal: "asc" });
    expect(args.select).not.toHaveProperty("extractedText");
    expect(args.select).not.toHaveProperty("storageKey");
  });

  it("getAttachmentForProject: filtr po id i projekcie, zwraca tekst, cudzy projekt daje null", async () => {
    m.prismaAttachment.findFirst.mockResolvedValueOnce({ ...viewRow(), extractedText: "Pełny tekst." });

    const found = await getAttachmentForProject("p1", "a1");

    expect(found).toMatchObject({ id: "a1", extractedText: "Pełny tekst." });
    expect(m.prismaAttachment.findFirst.mock.calls[0][0].where).toEqual({ id: "a1", projectId: "p1" });
    expect(m.prismaAttachment.findFirst.mock.calls[0][0].select).not.toHaveProperty("storageKey");

    m.prismaAttachment.findFirst.mockResolvedValueOnce(null);
    expect(await getAttachmentForProject("p-obcy", "a1")).toBeNull();
  });

  it("getAttachmentByOrdinal: filtr po projekcie i numerze", async () => {
    m.prismaAttachment.findFirst.mockResolvedValueOnce({ ...viewRow({ ordinal: 3 }), extractedText: "Tekst." });

    const found = await getAttachmentByOrdinal("p1", 3);

    expect(found).toMatchObject({ ordinal: 3, extractedText: "Tekst." });
    expect(m.prismaAttachment.findFirst.mock.calls[0][0].where).toEqual({ projectId: "p1", ordinal: 3 });
  });

  it("uszkodzony rekord w bazie to jawny wyjątek, nie ciche pominięcie", async () => {
    m.prismaAttachment.findMany.mockResolvedValue([viewRow({ kind: "XLSX" })]);

    await expect(listAttachmentsForProject("p1")).rejects.toThrow();
  });

  it("countAttachments liczy po projekcie", async () => {
    m.prismaAttachment.count.mockResolvedValue(4);

    expect(await countAttachments("p1")).toBe(4);
    expect(m.prismaAttachment.count).toHaveBeenCalledWith({ where: { projectId: "p1" } });
  });
});

describe("deleteAttachment", () => {
  it("usuwa rekord z projektu i zwraca klucz pliku do usunięcia z magazynu", async () => {
    world.rows = [{ id: "a1", projectId: "p1", ordinal: 1 }];

    expect(await deleteAttachment("p1", "a1")).toEqual({ ok: true, storageKey: "klucz-a1" });

    expect(m.txAttachment.deleteMany).toHaveBeenCalledWith({ where: { id: "a1", projectId: "p1" } });
    expect(world.rows).toHaveLength(0);
  });

  it("cudzy projekt lub nieistniejący id: NOT_FOUND i nic nie jest usuwane", async () => {
    world.rows = [{ id: "a1", projectId: "p1", ordinal: 1 }];

    expect(await deleteAttachment("p-obcy", "a1")).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await deleteAttachment("p1", "nie-ma")).toEqual({ ok: false, error: "NOT_FOUND" });

    expect(m.txAttachment.deleteMany).not.toHaveBeenCalled();
    expect(world.rows).toHaveLength(1);
  });

  it("równoległe usunięcie (deleteMany zwraca 0): NOT_FOUND", async () => {
    world.rows = [{ id: "a1", projectId: "p1", ordinal: 1 }];
    m.txAttachment.deleteMany.mockResolvedValue({ count: 0 });

    expect(await deleteAttachment("p1", "a1")).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("nie zmienia licznika numerów projektu (numer usuniętego załącznika nie wraca)", async () => {
    world.rows = [{ id: "a1", projectId: "p1", ordinal: 1 }];
    world.seq = 1;

    await deleteAttachment("p1", "a1");

    expect(m.queryRaw).not.toHaveBeenCalled();
    expect(m.txProject.update).not.toHaveBeenCalled();
    expect(world.seq).toBe(1);
  });
});
