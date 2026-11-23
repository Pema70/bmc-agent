import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFileSystemStorage, newStorageKey } from "@/lib/attachments/storage";

// Prawdziwe: akcja, deleteAttachment i magazyn (katalog tymczasowy). Zamockowane: uprawnienia, klient Prisma, revalidatePath.
const world = vi.hoisted(() => ({ rows: [] as Array<{ id: string; projectId: string; storageKey: string }> }));

const m = vi.hoisted(() => ({
  requireProjectRole: vi.fn(),
  revalidatePath: vi.fn(),
  txAttachment: { findFirst: vi.fn(), deleteMany: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth/permissions", () => ({ requireProjectRole: m.requireProjectRole }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/db/client", () => ({ prisma: { $transaction: m.transaction } }));

import { deleteAttachmentAction } from "@/app/projekty/[id]/attachment-actions";

const session = { user: { id: "u1", email: "jan@example.com", name: null } };
const editor = { ok: true, session, projectId: "p1", role: "EDITOR" };

let dir: string;
let key: string;

beforeEach(async () => {
  vi.clearAllMocks();
  dir = mkdtempSync(join(tmpdir(), "bmc-actions-"));
  vi.stubEnv("ATTACHMENTS_DIR", dir);
  key = newStorageKey();
  await createFileSystemStorage(dir).put(key, new Uint8Array([1, 2, 3]));
  world.rows = [{ id: "a1", projectId: "p1", storageKey: key }];

  m.requireProjectRole.mockResolvedValue(editor);
  m.txAttachment.findFirst.mockImplementation(async (args: { where: { id: string; projectId: string } }) => {
    const found = world.rows.find((r) => r.id === args.where.id && r.projectId === args.where.projectId);
    return found ? { storageKey: found.storageKey } : null;
  });
  m.txAttachment.deleteMany.mockImplementation(async (args: { where: { id: string; projectId: string } }) => {
    const before = world.rows.length;
    world.rows = world.rows.filter((r) => !(r.id === args.where.id && r.projectId === args.where.projectId));
    return { count: before - world.rows.length };
  });
  m.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback({ attachment: m.txAttachment }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("deleteAttachmentAction", () => {
  it("wymaga roli EDITOR", async () => {
    await deleteAttachmentAction("p1", "a1");

    expect(m.requireProjectRole).toHaveBeenCalledWith("p1", "EDITOR");
  });

  it("usuwa rekord, potem plik z magazynu, i odświeża stronę", async () => {
    const result = await deleteAttachmentAction("p1", "a1");

    expect(result).toEqual({ ok: true });
    expect(world.rows).toHaveLength(0);
    expect(existsSync(join(dir, key))).toBe(false);
    expect(m.revalidatePath).toHaveBeenCalledWith("/projekty/p1");
    expect(m.txAttachment.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(m.revalidatePath.mock.invocationCallOrder[0]);
  });

  it("VIEWER: FORBIDDEN, rekord i plik nietknięte", async () => {
    m.requireProjectRole.mockResolvedValue({ ok: false, error: "FORBIDDEN", session, projectId: "p1", role: "VIEWER" });

    const result = await deleteAttachmentAction("p1", "a1");

    expect(result).toMatchObject({ ok: false, error: "FORBIDDEN" });
    expect(m.transaction).not.toHaveBeenCalled();
    expect(world.rows).toHaveLength(1);
    expect(existsSync(join(dir, key))).toBe(true);
  });

  it("brak sesji lub obcy projekt: przerwanie z requireProjectRole, nic nie usunięte", async () => {
    m.requireProjectRole.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(deleteAttachmentAction("p-obcy", "a1")).rejects.toThrow("NEXT_REDIRECT");
    expect(m.transaction).not.toHaveBeenCalled();
    expect(existsSync(join(dir, key))).toBe(true);
  });

  it("załącznik z innego projektu: NOT_FOUND, plik nietknięty", async () => {
    world.rows = [{ id: "a-obcy", projectId: "p-inny", storageKey: key }];

    const result = await deleteAttachmentAction("p1", "a-obcy");

    expect(result).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(world.rows).toHaveLength(1);
    expect(existsSync(join(dir, key))).toBe(true);
  });

  it("nieprawidłowy identyfikator: VALIDATION bez zapytania do bazy", async () => {
    const result = await deleteAttachmentAction("p1", "  ");

    expect(result).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("brak pliku w magazynie nie blokuje usunięcia rekordu", async () => {
    await createFileSystemStorage(dir).remove(key);

    const result = await deleteAttachmentAction("p1", "a1");

    expect(result).toEqual({ ok: true });
    expect(world.rows).toHaveLength(0);
  });
});
