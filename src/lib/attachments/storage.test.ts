import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileSystemStorage, newStorageKey } from "@/lib/attachments/storage";
import { STORAGE_KEY_PATTERN } from "@/lib/schemas/attachment";

describe("newStorageKey", () => {
  it("daje losowy klucz w poprawnym formacie, różny przy każdym wywołaniu", () => {
    const keys = new Set(Array.from({ length: 20 }, () => newStorageKey()));

    expect(keys.size).toBe(20);
    for (const key of keys) {
      expect(key).toMatch(STORAGE_KEY_PATTERN);
    }
  });
});

describe("createFileSystemStorage", () => {
  let dir: string;
  let root: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bmc-attachments-"));
    root = join(dir, "magazyn");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("zapisuje (z utworzeniem katalogu), odczytuje i usuwa plik", async () => {
    const storage = createFileSystemStorage(root);
    const key = newStorageKey();

    await storage.put(key, new Uint8Array([1, 2, 3]));
    expect(existsSync(root)).toBe(true);
    expect(Array.from((await storage.get(key)) ?? [])).toEqual([1, 2, 3]);

    expect(await storage.remove(key)).toBe(true);
    expect(await storage.get(key)).toBeNull();
    expect(readdirSync(root)).toEqual([]);
  });

  it("odczyt i usunięcie nieistniejącego pliku to null i false, bez wyjątku", async () => {
    const storage = createFileSystemStorage(root);
    const key = newStorageKey();

    expect(await storage.get(key)).toBeNull();
    expect(await storage.remove(key)).toBe(false);
  });

  it("nie nadpisuje istniejącego pliku", async () => {
    const storage = createFileSystemStorage(root);
    const key = newStorageKey();
    await storage.put(key, new Uint8Array([1]));

    await expect(storage.put(key, new Uint8Array([2]))).rejects.toThrow();
    expect(Array.from((await storage.get(key)) ?? [])).toEqual([1]);
  });

  it.each([
    ["wyjście przez ..", "../" + "a".repeat(29)],
    ["separator ścieżki", "a/" + "b".repeat(30)],
    ["backslash", "a\\" + "b".repeat(30)],
    ["pusty", ""],
    ["za krótki", "abc"],
    ["za długi", "a".repeat(33)],
    ["znaki spoza zestawu", "a".repeat(31) + "."],
    ["ścieżka bezwzględna", "/etc/passwd"],
  ])("odrzuca niepoprawny klucz: %s", async (_name, key) => {
    const storage = createFileSystemStorage(root);

    await expect(storage.put(key, new Uint8Array([1]))).rejects.toThrow("Niepoprawny klucz");
    await expect(storage.get(key)).rejects.toThrow("Niepoprawny klucz");
    await expect(storage.remove(key)).rejects.toThrow("Niepoprawny klucz");
  });

  it("żadna operacja nie tworzy plików poza katalogiem magazynu", async () => {
    const storage = createFileSystemStorage(root);

    await expect(storage.put("..", new Uint8Array([1]))).rejects.toThrow();

    expect(readdirSync(dir)).toEqual([]);
  });
});
