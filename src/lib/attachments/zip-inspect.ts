import { inflateRaw } from "node:zlib";

/**
 * Kontrola archiwum ZIP (DOCX) przed przekazaniem go do biblioteki ekstrakcji (obrona przed „bombą ZIP”).
 * Własny, minimalny czytnik spisu zawartości (central directory), bez importowania jszip (to zależność przechodnia
 * mammoth). Dwa kroki:
 * 1. inspectZip: spis zawartości, liczba plików i zadeklarowany łączny rozmiar po rozpakowaniu (szybko, bez rozpakowywania);
 * 2. verifyZipInflation: faktyczne rozpakowanie każdego pliku z twardym limitem wyjścia (node:zlib `maxOutputLength`),
 *    bo zadeklarowane rozmiary w spisie może sfałszować sam plik. Rozpakowanie jest asynchroniczne (wątki libuv),
 *    więc nie blokuje pętli zdarzeń.
 */

export type ZipEntry = {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

export type ZipError = "NOT_ZIP" | "ZIP64" | "UNSUPPORTED" | "TOO_MANY_ENTRIES" | "TOO_LARGE" | "CORRUPT";

export type ZipInspection = { ok: true; entries: ZipEntry[] } | { ok: false; error: ZipError };

export type ZipLimits = { maxEntries: number; maxUncompressedBytes: number };

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT = 0xffff;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export function inspectZip(bytes: Uint8Array, limits: ZipLimits): ZipInspection {
  if (bytes.length < EOCD_MIN_SIZE) {
    return { ok: false, error: "NOT_ZIP" };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== LOCAL_SIGNATURE) {
    return { ok: false, error: "NOT_ZIP" };
  }

  let eocd = -1;
  const lowest = Math.max(0, bytes.length - EOCD_MIN_SIZE - MAX_COMMENT);
  for (let i = bytes.length - EOCD_MIN_SIZE; i >= lowest; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    return { ok: false, error: "NOT_ZIP" };
  }

  // ZIP64 (duże archiwa) nie jest obsługiwany: dokument tekstowy do 10 MB go nie potrzebuje, a odrzucenie zamyka obejście limitów.
  if (eocd >= 20 && view.getUint32(eocd - 20, true) === ZIP64_LOCATOR_SIGNATURE) {
    return { ok: false, error: "ZIP64" };
  }
  const diskNumber = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const totalEntries = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const commentLength = view.getUint16(eocd + 20, true);

  if (totalEntries === MAX_UINT16 || centralSize === MAX_UINT32 || centralOffset === MAX_UINT32) {
    return { ok: false, error: "ZIP64" };
  }
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
    return { ok: false, error: "UNSUPPORTED" };
  }
  if (eocd + EOCD_MIN_SIZE + commentLength > bytes.length || centralOffset + centralSize > eocd) {
    return { ok: false, error: "CORRUPT" };
  }
  // Liczbę plików sprawdzamy przed pętlą po spisie, żeby ogromny spis nie zajął procesora.
  if (totalEntries > limits.maxEntries) {
    return { ok: false, error: "TOO_MANY_ENTRIES" };
  }

  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder("utf-8");
  let position = centralOffset;
  let declaredTotal = 0;

  for (let index = 0; index < totalEntries; index++) {
    if (position + 46 > eocd || view.getUint32(position, true) !== CENTRAL_SIGNATURE) {
      return { ok: false, error: "CORRUPT" };
    }
    const flags = view.getUint16(position + 8, true);
    const method = view.getUint16(position + 10, true);
    const compressedSize = view.getUint32(position + 20, true);
    const uncompressedSize = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLen = view.getUint16(position + 32, true);
    const localOffset = view.getUint32(position + 42, true);
    const next = position + 46 + nameLength + extraLength + commentLen;
    if (next > eocd) {
      return { ok: false, error: "CORRUPT" };
    }
    if (compressedSize === MAX_UINT32 || uncompressedSize === MAX_UINT32 || localOffset === MAX_UINT32) {
      return { ok: false, error: "ZIP64" };
    }
    if ((flags & 0x1) !== 0 || (method !== METHOD_STORED && method !== METHOD_DEFLATE)) {
      // Szyfrowane pliki i inne metody kompresji niż stored/deflate nie występują w poprawnym DOCX.
      return { ok: false, error: "UNSUPPORTED" };
    }
    if (compressedSize > bytes.length || localOffset + 30 > bytes.length) {
      return { ok: false, error: "CORRUPT" };
    }

    declaredTotal += uncompressedSize;
    if (declaredTotal > limits.maxUncompressedBytes) {
      return { ok: false, error: "TOO_LARGE" };
    }
    const name = decoder.decode(bytes.subarray(position + 46, position + 46 + nameLength));
    entries.push({ name, method, flags, compressedSize, uncompressedSize, localOffset });
    position = next;
  }

  return { ok: true, entries };
}

export type ZipInflation = { ok: true; totalBytes: number } | { ok: false; error: "TOO_LARGE" | "CORRUPT" };

function inflate(data: Buffer, maxOutputLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    inflateRaw(data, { maxOutputLength }, (error, result) => (error ? reject(error) : resolve(result)));
  });
}

/**
 * Faktycznie rozpakowuje każdy plik archiwum z łącznym limitem wyjścia. Zadeklarowany rozmiar musi zgadzać się z
 * faktycznym (niezgodność to uszkodzony lub sfałszowany plik). Zwraca TOO_LARGE, gdy łączny wynik przekroczy limit.
 */
export async function verifyZipInflation(
  bytes: Uint8Array,
  entries: ZipEntry[],
  maxUncompressedBytes: number,
): Promise<ZipInflation> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let total = 0;

  for (const entry of entries) {
    if (entry.name.endsWith("/")) {
      continue;
    }
    if (view.getUint32(entry.localOffset, true) !== LOCAL_SIGNATURE) {
      return { ok: false, error: "CORRUPT" };
    }
    const nameLength = view.getUint16(entry.localOffset + 26, true);
    const extraLength = view.getUint16(entry.localOffset + 28, true);
    const start = entry.localOffset + 30 + nameLength + extraLength;
    const end = start + entry.compressedSize;
    if (end > bytes.length) {
      return { ok: false, error: "CORRUPT" };
    }
    const data = Buffer.from(bytes.subarray(start, end));

    let actual: number;
    if (entry.method === METHOD_STORED) {
      actual = data.length;
      if (total + actual > maxUncompressedBytes) {
        return { ok: false, error: "TOO_LARGE" };
      }
    } else {
      const remaining = maxUncompressedBytes - total;
      if (remaining < 1) {
        return { ok: false, error: "TOO_LARGE" };
      }
      try {
        actual = (await inflate(data, remaining)).length;
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
        return { ok: false, error: code === "ERR_BUFFER_TOO_LARGE" ? "TOO_LARGE" : "CORRUPT" };
      }
    }
    if (actual !== entry.uncompressedSize) {
      return { ok: false, error: "CORRUPT" };
    }
    total += actual;
  }

  return { ok: true, totalBytes: total };
}
