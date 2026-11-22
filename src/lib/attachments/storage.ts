import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { STORAGE_KEY_PATTERN } from "@/lib/schemas/attachment";

/**
 * Magazyn plików załączników. Reszta kodu zna tylko ten interfejs, więc magazyn na dysku (dev) da się później
 * podmienić na zewnętrzny (produkcja) bez zmian w logice załączników.
 */
export interface AttachmentStorage {
  /** Zapisuje plik pod nowym kluczem; istniejącego klucza nie nadpisuje (błąd). */
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** Zwraca bajty albo null, gdy pliku nie ma. */
  get(key: string): Promise<Uint8Array | null>;
  /** Usuwa plik; zwraca false, gdy go nie było. Wywołujemy tylko na wyraźne polecenie użytkownika. */
  remove(key: string): Promise<boolean>;
}

export function newStorageKey(): string {
  return randomBytes(24).toString("base64url");
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** Magazyn na dysku lokalnym. Ścieżka powstaje wyłącznie z poprawnego klucza i zawsze leży w katalogu magazynu. */
export function createFileSystemStorage(dir: string): AttachmentStorage {
  const root = resolve(dir);

  function pathFor(key: string): string {
    if (!STORAGE_KEY_PATTERN.test(key)) {
      throw new Error("Niepoprawny klucz magazynu plików.");
    }
    const full = resolve(root, key);
    if (!full.startsWith(root + sep)) {
      throw new Error("Klucz magazynu wychodzi poza katalog magazynu.");
    }
    return full;
  }

  return {
    async put(key, bytes) {
      const full = pathFor(key);
      await mkdir(root, { recursive: true });
      await writeFile(full, bytes, { flag: "wx" });
    },
    async get(key) {
      const full = pathFor(key);
      try {
        return new Uint8Array(await readFile(full));
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },
    async remove(key) {
      const full = pathFor(key);
      try {
        await unlink(full);
        return true;
      } catch (error) {
        if (isNotFound(error)) {
          return false;
        }
        throw error;
      }
    },
  };
}
