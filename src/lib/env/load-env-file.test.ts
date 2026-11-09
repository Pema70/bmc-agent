import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnvFileIfExists } from "@/lib/env/load-env-file";

const TEST_KEY = "BMC_TEST_LOAD_ENV_FILE";

describe("loadEnvFileIfExists", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bmc-env-"));
    delete process.env[TEST_KEY];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env[TEST_KEY];
    vi.restoreAllMocks();
  });

  it("ładuje zmienne, gdy plik istnieje", () => {
    const file = join(dir, ".env");
    writeFileSync(file, `${TEST_KEY}=wartosc\n`);

    expect(loadEnvFileIfExists(file)).toBe(true);
    expect(process.env[TEST_KEY]).toBe("wartosc");
  });

  it("wypisuje komunikat i nie rzuca wyjątku, gdy pliku brak", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(loadEnvFileIfExists(join(dir, ".env"))).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain(".env.example");
    expect(process.env[TEST_KEY]).toBeUndefined();
  });
});
