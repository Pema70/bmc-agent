import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Ładuje zmienne z pliku .env wbudowanym `process.loadEnvFile()` (Node 22+).
 * Brak pliku (np. świeży klon) nie przerywa działania: wypisuje komunikat i zwraca `false`,
 * żeby polecenia niewymagające bazy (np. `prisma generate`) nadal działały.
 */
export function loadEnvFileIfExists(path = ".env"): boolean {
  const fullPath = resolve(path);

  if (!existsSync(fullPath)) {
    console.warn(
      `[env] Nie znaleziono pliku ${fullPath}. Skopiuj .env.example do .env i uzupełnij wartości ` +
        "(polecenia wymagające bazy danych nie zadziałają bez DATABASE_URL).",
    );
    return false;
  }

  process.loadEnvFile(fullPath);
  return true;
}
