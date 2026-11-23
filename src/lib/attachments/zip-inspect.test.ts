import { describe, expect, it } from "vitest";
import { buildDocx, buildZip } from "@/lib/attachments/build-test-files";
import { inspectZip, verifyZipInflation } from "@/lib/attachments/zip-inspect";

const limits = { maxEntries: 100, maxUncompressedBytes: 1024 * 1024 };
const MB = 1024 * 1024;

function mutate(bytes: Uint8Array, edit: (view: DataView, eocd: number) => void): Uint8Array {
  const copy = new Uint8Array(bytes);
  const view = new DataView(copy.buffer);
  let eocd = copy.length - 22;
  while (view.getUint32(eocd, true) !== 0x06054b50) {
    eocd--;
  }
  edit(view, eocd);
  return copy;
}

describe("inspectZip (spis zawartości, bez rozpakowywania)", () => {
  it("czyta spis poprawnego DOCX: nazwy, metody i rozmiary", () => {
    const result = inspectZip(buildDocx(["Kawiarnia"]), limits);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.map((e) => e.name)).toEqual(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
    expect(result.entries.every((e) => e.method === 8 && e.uncompressedSize > 0)).toBe(true);
  });

  it("plik, który nie jest ZIP-em, to NOT_ZIP (także krótki i pusty)", () => {
    expect(inspectZip(new Uint8Array(0), limits)).toEqual({ ok: false, error: "NOT_ZIP" });
    expect(inspectZip(new Uint8Array([1, 2, 3]), limits)).toEqual({ ok: false, error: "NOT_ZIP" });
    expect(inspectZip(new Uint8Array(Buffer.from("To jest zwykły tekst, a nie archiwum ZIP.")), limits)).toEqual({
      ok: false,
      error: "NOT_ZIP",
    });
  });

  it("zbyt wiele plików: TOO_MANY_ENTRIES (sprawdzane przed pętlą po spisie)", () => {
    const zip = buildZip(Array.from({ length: 101 }, (_, i) => ({ name: `f${i}.txt`, data: "x" })));

    expect(inspectZip(zip, limits)).toEqual({ ok: false, error: "TOO_MANY_ENTRIES" });
    expect(inspectZip(zip, { ...limits, maxEntries: 101 }).ok).toBe(true);
  });

  it("zadeklarowany łączny rozmiar po rozpakowaniu ponad limit: TOO_LARGE bez rozpakowywania", () => {
    // 40 MB zer kompresuje się do ok. 40 KB (klasyczna bomba), a spis uczciwie deklaruje 40 MB.
    const zip = buildZip([{ name: "word/document.xml", data: new Uint8Array(40 * MB) }]);

    expect(zip.length).toBeLessThan(MB);
    expect(inspectZip(zip, limits)).toEqual({ ok: false, error: "TOO_LARGE" });
  });

  it("limit dotyczy sumy kilku plików", () => {
    const zip = buildZip([
      { name: "a.bin", data: new Uint8Array(600 * 1024) },
      { name: "b.bin", data: new Uint8Array(600 * 1024) },
    ]);

    expect(inspectZip(zip, limits)).toEqual({ ok: false, error: "TOO_LARGE" });
  });

  it("szyfrowany plik to UNSUPPORTED", () => {
    expect(inspectZip(buildZip([{ name: "a.xml", data: "x", encrypted: true }]), limits)).toEqual({
      ok: false,
      error: "UNSUPPORTED",
    });
  });

  it("ZIP64 (liczba plików 0xFFFF w EOCD) to ZIP64", () => {
    const zip = mutate(buildZip([{ name: "a.xml", data: "x" }]), (view, eocd) => {
      view.setUint16(eocd + 8, 0xffff, true);
      view.setUint16(eocd + 10, 0xffff, true);
    });

    expect(inspectZip(zip, limits)).toEqual({ ok: false, error: "ZIP64" });
  });

  it("uszkodzony spis (zły offset) to CORRUPT, a ucięty plik nie jest akceptowany", () => {
    const zip = buildZip([{ name: "a.xml", data: "x" }]);
    const badOffset = mutate(zip, (view, eocd) => view.setUint32(eocd + 16, 0xfffff0, true));

    expect(inspectZip(badOffset, limits)).toEqual({ ok: false, error: "CORRUPT" });
    expect(inspectZip(zip.subarray(0, zip.length - 10), limits).ok).toBe(false);
  });

  it("liczba plików w EOCD większa niż faktyczny spis to CORRUPT", () => {
    const zip = mutate(buildZip([{ name: "a.xml", data: "x" }]), (view, eocd) => {
      view.setUint16(eocd + 8, 5, true);
      view.setUint16(eocd + 10, 5, true);
    });

    expect(inspectZip(zip, limits)).toEqual({ ok: false, error: "CORRUPT" });
  });
});

describe("verifyZipInflation (faktyczne rozpakowanie z twardym limitem)", () => {
  it("poprawny DOCX: łączny rozmiar równa się sumie zadeklarowanych", async () => {
    const zip = buildDocx(["Kawiarnia w centrum"]);
    const inspection = inspectZip(zip, limits);
    if (!inspection.ok) throw new Error("spis");

    const result = await verifyZipInflation(zip, inspection.entries, limits.maxUncompressedBytes);

    expect(result).toEqual({ ok: true, totalBytes: inspection.entries.reduce((s, e) => s + e.uncompressedSize, 0) });
  });

  it("sfałszowany spis (deklaruje 10 bajtów, w środku 20 MB zer): TOO_LARGE, a pamięć nie rośnie ponad limit", async () => {
    const zip = buildZip([{ name: "word/document.xml", data: new Uint8Array(20 * MB), declaredUncompressed: 10 }]);
    const inspection = inspectZip(zip, limits);
    // Spis „kłamie”, więc szybka kontrola go przepuszcza…
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;

    // …ale faktyczne rozpakowanie jest przerywane limitem wyjścia.
    expect(await verifyZipInflation(zip, inspection.entries, MB)).toEqual({ ok: false, error: "TOO_LARGE" });
  });

  it("niezgodność zadeklarowanego i faktycznego rozmiaru (mały plik) to CORRUPT", async () => {
    const zip = buildZip([{ name: "a.xml", data: "abcdefghij", declaredUncompressed: 3 }]);
    const inspection = inspectZip(zip, limits);
    if (!inspection.ok) throw new Error("spis");

    expect(await verifyZipInflation(zip, inspection.entries, MB)).toEqual({ ok: false, error: "CORRUPT" });
  });

  it("limit obejmuje sumę plików, także zapisanych bez kompresji", async () => {
    const zip = buildZip([
      { name: "a.bin", data: new Uint8Array(600 * 1024), method: "stored" },
      { name: "b.bin", data: new Uint8Array(600 * 1024), method: "stored" },
    ]);
    const inspection = inspectZip(zip, { ...limits, maxUncompressedBytes: 5 * MB });
    if (!inspection.ok) throw new Error("spis");

    expect(await verifyZipInflation(zip, inspection.entries, MB)).toEqual({ ok: false, error: "TOO_LARGE" });
  });

  it("uszkodzone dane skompresowane to CORRUPT", async () => {
    const zip = buildZip([{ name: "a.xml", data: "Zażółć gęślą jaźń. ".repeat(50) }]);
    const inspection = inspectZip(zip, limits);
    if (!inspection.ok) throw new Error("spis");
    const broken = new Uint8Array(zip);
    for (let i = 40; i < 60; i++) broken[i] = 0xff;

    expect(await verifyZipInflation(broken, inspection.entries, MB)).toEqual({ ok: false, error: "CORRUPT" });
  });
});
