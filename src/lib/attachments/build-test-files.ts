import { crc32, deflateRawSync } from "node:zlib";

/**
 * Pomocnicze generatory plików testowych (PDF, ZIP, DOCX) budowane w pamięci, wyłącznie dla testów. Dzięki temu w
 * repozytorium nie ma plików binarnych, a przypadki brzegowe (skan, bomba ZIP, sfałszowany spis zawartości) są jawne.
 * Dane są przykładowe.
 */

function latin1(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "latin1"));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * Minimalny PDF z jedną stroną na element. Tekst ASCII (standardowa czcionka Helvetica, bez osadzania); `null` daje
 * stronę bez warstwy tekstowej (sam prostokąt), czyli jak skan.
 */
export function buildPdf(pages: Array<string | null>): Uint8Array {
  const objects: string[] = [];
  const pageObjectNumbers = pages.map((_, index) => 4 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((text, index) => {
    const pageNumber = 4 + index * 2;
    const contentNumber = pageNumber + 1;
    const stream = text === null ? "0 0 100 100 re f" : `BT /F1 12 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
    objects[pageNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`;
    objects[contentNumber] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let number = 1; number < objects.length; number++) {
    offsets[number] = body.length;
    body += `${number} 0 obj\n${objects[number]}\nendobj\n`;
  }
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let number = 1; number < objects.length; number++) {
    body += `${String(offsets[number]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return latin1(body);
}

export type ZipTestEntry = {
  name: string;
  data: Uint8Array | string;
  method?: "deflate" | "stored";
  /** Zadeklarowany w spisie rozmiar po rozpakowaniu (do testów sfałszowanego spisu); domyślnie prawdziwy. */
  declaredUncompressed?: number;
  /** Ustawia bit szyfrowania w spisie (do testu nieobsługiwanych archiwów). */
  encrypted?: boolean;
};

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

/** Buduje archiwum ZIP (metody stored i deflate) ze spisem zawartości na końcu. */
export function buildZip(entries: ZipTestEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = typeof entry.data === "string" ? new Uint8Array(Buffer.from(entry.data, "utf8")) : entry.data;
    const method = entry.method === "stored" ? 0 : 8;
    const compressed = method === 0 ? raw : new Uint8Array(deflateRawSync(raw));
    const name = new Uint8Array(Buffer.from(entry.name, "utf8"));
    const crc = crc32(raw);
    const flags = entry.encrypted ? 1 : 0;
    const declared = entry.declaredUncompressed ?? raw.length;

    const local = concat([
      u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0x21), u32(crc),
      u32(compressed.length), u32(raw.length), u16(name.length), u16(0), name, compressed,
    ]);
    central.push(
      concat([
        u32(0x02014b50), u16(20), u16(20), u16(flags), u16(method), u16(0), u16(0x21), u32(crc),
        u32(compressed.length), u32(declared), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0),
        u32(offset), name,
      ]),
    );
    chunks.push(local);
    offset += local.length;
  }

  const centralBytes = concat(central);
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralBytes.length), u32(offset), u16(0),
  ]);
  return concat([...chunks, centralBytes, end]);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Minimalny poprawny DOCX z akapitami tekstu (dodatkowe pliki można dodać przez `extra`). */
export function buildDocx(paragraphs: string[], extra: ZipTestEntry[] = []): Uint8Array {
  const body = paragraphs.map((text) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`).join("");
  return buildZip([
    {
      name: "[Content_Types].xml",
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        "</Types>",
    },
    {
      name: "_rels/.rels",
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        "</Relationships>",
    },
    {
      name: "word/document.xml",
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        body +
        "</w:body></w:document>",
    },
    ...extra,
  ]);
}
