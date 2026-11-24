import { exportHref } from "@/lib/export/links";

type ExportPanelProps = {
  projectId: string;
  variantId: string;
  variantVersion: number;
};

const linkClass =
  "w-fit rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

/**
 * Pobieranie wybranego wariantu jako PDF (układ płótna), DOCX (wersja tekstowa) oraz rozszerzonego raportu. Dostępne dla każdego członka projektu.
 * Zwykłe linki do route handlera (przeglądarka pobiera plik), bez stanu po stronie klienta. Eksport dotyczy zapisanego stanu.
 */
export function ExportPanel({ projectId, variantId, variantVersion }: ExportPanelProps) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="export-heading">
      <h2 id="export-heading" className="text-lg font-semibold">
        Eksport i raport
      </h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Eksport dotyczy zapisanego stanu wariantu (wersja {variantVersion}); niezapisane zmiany nie są uwzględnione. Treści
        wygenerowane przez AI są w dokumencie oznaczone i są opinią modelu, a nie weryfikacją biznesową.
      </p>
      <div className="flex flex-wrap gap-3">
        <a className={linkClass} href={exportHref(projectId, variantId, "pdf", "plansza")} download>
          Pobierz PDF (płótno)
        </a>
        <a className={linkClass} href={exportHref(projectId, variantId, "docx", "plansza")} download>
          Pobierz DOCX (tekst)
        </a>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Rozszerzony raport zawiera płótno z kodami źródeł wpisów, opisy bloków, załączniki, oceny, cykle poprawek, analizy
        wpływu, porównania oraz modele i wersje promptów. Składa się z zapisanych danych i nie wywołuje modelu.
      </p>
      <div className="flex flex-wrap gap-3">
        <a className={linkClass} href={exportHref(projectId, variantId, "pdf", "raport")} download>
          Pobierz raport PDF
        </a>
        <a className={linkClass} href={exportHref(projectId, variantId, "docx", "raport")} download>
          Pobierz raport DOCX
        </a>
      </div>
    </section>
  );
}
