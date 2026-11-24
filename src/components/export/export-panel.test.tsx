import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExportPanel } from "@/components/export/export-panel";
import { exportHref } from "@/lib/export/links";

describe("exportHref", () => {
  it("składa adres route handlera z parametrami wariantu, formatu i rodzaju", () => {
    expect(exportHref("p1", "v1", "pdf", "plansza")).toBe("/api/projekty/p1/eksport?wariant=v1&format=pdf&rodzaj=plansza");
    expect(exportHref("p1", "v1", "docx", "plansza")).toContain("format=docx");
  });

  it("koduje znaki specjalne w identyfikatorach", () => {
    const href = exportHref("p/1", "v&1=x", "pdf", "plansza");

    expect(href).toContain("/api/projekty/p%2F1/eksport");
    expect(href).toContain("wariant=v%261%3Dx");
  });
});

describe("ExportPanel", () => {
  const markup = renderToStaticMarkup(<ExportPanel projectId="p1" variantId="v1" variantVersion={7} />);

  it("ma dwa linki pobierania (PDF i DOCX) z atrybutem download", () => {
    expect(markup).toContain('href="/api/projekty/p1/eksport?wariant=v1&amp;format=pdf&amp;rodzaj=plansza"');
    expect(markup).toContain('href="/api/projekty/p1/eksport?wariant=v1&amp;format=docx&amp;rodzaj=plansza"');
    expect((markup.match(/download/g) ?? []).length).toBe(2);
    expect(markup).toContain("Pobierz PDF (płótno)");
    expect(markup).toContain("Pobierz DOCX (tekst)");
  });

  it("mówi, że eksport dotyczy zapisanego stanu (wersja N) i że treści AI są oznaczone", () => {
    expect(markup).toContain("zapisanego stanu wariantu (wersja 7)");
    expect(markup).toContain("niezapisane zmiany nie są uwzględnione");
    expect(markup).toContain("opinią modelu");
  });
});
