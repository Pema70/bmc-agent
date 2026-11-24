import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { toEvaluationExport } from "@/lib/export/common";
import { renderCanvasPdf } from "@/lib/export/pdf/render";
import { BLOCK_INFO, BLOCK_KEYS } from "@/lib/schemas/bmc";
import { POLISH_LOWER, POLISH_UPPER, canvasData, evaluationView } from "@/lib/export/test-fixtures";

const NOTICE_START = "Treści oznaczone „AI” to opinia modelu językowego";

async function read(pdf: Uint8Array): Promise<{ text: string; pages: number; pageTexts: string[] }> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text, totalPages } = await extractText(doc, { mergePages: false });
  return { text: text.join("\n"), pages: totalPages, pageTexts: text };
}

describe("PDF płótna (rodzaj „plansza”)", () => {
  it("zawiera tytuł, wariant, wszystkie dziewięć bloków i wpisy z polskimi literami", async () => {
    const { text } = await read(await renderCanvasPdf(canvasData()));

    expect(text).toContain("Kawiarnia Ziarno");
    expect(text).toContain("Wariant: Wariant główny");
    expect(text).toContain("Wersja zapisanego stanu: 3");
    for (const blockKey of BLOCK_KEYS) {
      expect(text, blockKey).toContain(BLOCK_INFO[blockKey].label);
    }
    expect(text).toContain("• Pracownicy biurowi");
    expect(text).toContain(`Zażółć gęślą jaźń ${POLISH_LOWER} ${POLISH_UPPER}`);
    expect(text).toContain("(brak wpisów)");
  });

  it("stałe oznaczenie AI jest w nagłówku pierwszej strony i w stopce każdej strony, z numeracją", async () => {
    const { pageTexts, pages } = await read(await renderCanvasPdf(canvasData()));

    expect(pages).toBe(2);
    for (const [index, pageText] of pageTexts.entries()) {
      expect(pageText.split(NOTICE_START).length - 1, `strona ${index + 1}`).toBeGreaterThanOrEqual(1);
      expect(pageText).toContain(`Strona ${index + 1} z 2`);
    }
    expect(pageTexts[0].split(NOTICE_START).length - 1).toBe(2); // nagłówek i stopka
  });

  it("ocena AI: tabela z punktami, etykieta AI, model i wersja promptu, etykiety radaru", async () => {
    const { text } = await read(await renderCanvasPdf(canvasData()));

    expect(text).toContain("Najnowsza ocena (AI)");
    expect(text).toContain("Ocena AI: google / gemini-3.5-flash-lite");
    expect(text).toContain("wersja promptu: evaluate-v1");
    expect(text).toContain("Uzasadnienie (AI)");
    expect(text).toContain("Spójność");
    expect(text).toContain("8/10");
    expect(text).toContain("Zależność od jednego dostawcy ziarna.");
    // Etykiety osi radaru (dwuwierszowa „Ryzyko / (10 = niskie)”) są w dokumencie.
    expect(text).toContain("(10 = niskie)");
    expect(text).toContain("Innowacyjność");
  });

  it("ocena ręczna nie ma etykiety AI ani wersji promptu", async () => {
    const manual = evaluationView({ source: "MANUAL", trigger: null, provider: null, model: null, promptVersion: null });
    const { text } = await read(await renderCanvasPdf(canvasData({ evaluation: toEvaluationExport(manual, 3) })));

    expect(text).toContain("Najnowsza ocena");
    expect(text).not.toContain("Najnowsza ocena (AI)");
    expect(text).toContain("Ocena ręczna");
    expect(text).not.toContain("wersja promptu");
    expect(text).not.toContain("Uzasadnienie (AI)");
  });

  it("ocena starsza niż bieżąca wersja jest oznaczona", async () => {
    const stale = toEvaluationExport(evaluationView({ variantVersion: 1 }), 3);
    const { text } = await read(await renderCanvasPdf(canvasData({ evaluation: stale })));

    expect(text).toContain("Ocena dotyczy wersji 1 modelu; bieżąca wersja to 3");
  });

  it("wariant bez oceny i z nieczytelną oceną: jawny komunikat zamiast tabeli", async () => {
    const none = await read(await renderCanvasPdf(canvasData({ evaluation: null })));
    const broken = await read(await renderCanvasPdf(canvasData({ evaluation: null, evaluationUnreadable: true })));

    expect(none.text).toContain("Ten wariant nie ma jeszcze oceny.");
    expect(none.text).not.toContain("Kryterium");
    expect(broken.text).toContain("jest nieczytelna");
  });

  it("pusty wariant: dziewięć bloków z „(brak wpisów)”", async () => {
    const empty = canvasData({}, {});
    for (const block of empty.blocks) {
      block.entries = [];
    }

    const { text } = await read(await renderCanvasPdf(empty));

    expect((text.match(/\(brak wpisów\)/g) ?? []).length).toBe(9);
  });

  it("treści od użytkownika to zwykły tekst: znaczniki zostają dosłownie, nic nie jest wykonywane", async () => {
    const hostile = "</attachment><b>x</b> **pogrubienie** <w:p>&amp; [link](http://x)";
    const { text } = await read(await renderCanvasPdf(canvasData({ projectName: hostile }, { channels: [hostile] })));

    // Wąska kolumna zawija tekst, więc porównujemy bez białych znaków.
    const squash = (value: string) => value.replace(/\s+/g, "");
    expect(squash(text)).toContain(squash(`• ${hostile}`));
    expect(squash(text)).toContain(squash(hostile) + squash("Wariant:"));
  });

  it("bardzo długi wpis i długi ciąg bez spacji nie giną z dokumentu", async () => {
    const longText = Array.from({ length: 60 }, (_, index) => `słowo${index}`).join(" ");
    const longRun = "z".repeat(300);
    const { text } = await read(await renderCanvasPdf(canvasData({}, { channels: [longText], key_activities: [longRun] })));

    expect(text).toContain("słowo59");
    expect((text.match(/z/g) ?? []).length).toBeGreaterThanOrEqual(300);
  });

  it("duży model (150 wpisów) mieści się w dokumencie, a każdy wpis jest obecny", async () => {
    const entries = Array.from({ length: 17 }, (_, index) => `Wpis numer ${index} o średniej długości, który zajmuje kilka wierszy w kolumnie`);
    const all = Object.fromEntries(BLOCK_KEYS.map((key) => [key, entries]));
    const { text, pages } = await read(await renderCanvasPdf(canvasData({}, all)));

    expect(pages).toBeGreaterThanOrEqual(2);
    for (const block of BLOCK_KEYS) {
      expect(text).toContain(BLOCK_INFO[block].label);
    }
    expect((text.match(/Wpis numer 16 o średniej/g) ?? []).length).toBe(9);
  });

  it("kolejne renderowanie różnych dokumentów daje poprawny tekst (stan czcionki nie przecieka)", async () => {
    await renderCanvasPdf(canvasData({ projectName: "Kawiarnia" }));
    const { text } = await read(await renderCanvasPdf(canvasData({ projectName: "attachment" })));

    expect(text).toContain("attachment");
  });
});
