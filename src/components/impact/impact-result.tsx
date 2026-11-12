import { formatEvaluationDate } from "@/lib/evaluation/format";
import { describeChange, isImpactStale, sortAffected } from "@/lib/impact/format";
import { BLOCK_INFO } from "@/lib/schemas/bmc";
import { IMPACT_LEVEL_LABELS, type ImpactView } from "@/lib/schemas/impact";

/** Stałe oznaczenie: to jakościowa analiza AI, a nie weryfikacja biznesowa. */
export function ImpactNotice() {
  return (
    <p className="text-sm text-zinc-600 dark:text-zinc-400">
      To jakościowa opinia modelu językowego o możliwych zależnościach między blokami, a nie weryfikacja biznesowa ani
      prognoza liczbowa. Model nie sprawdza rynku i nie liczy kosztów ani przychodów. Analiza dotyczy zapisanego stanu
      wariantu, nie niezapisanych zmian w edytorze.
    </p>
  );
}

// Opis zmiany, podsumowanie i opisy wpływu pochodzą od użytkownika lub modelu: wyłącznie węzły tekstowe React,
// bez HTML i Markdown.
export function ImpactResult({ analysis, currentVersion }: { analysis: ImpactView; currentVersion: number }) {
  const affected = sortAffected(analysis.result.affected);

  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <span className="rounded-full border border-amber-600 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
          Analiza AI
        </span>
        <span>
          {analysis.provider} / {analysis.model} · prompt: {analysis.promptVersion} ·{" "}
          {formatEvaluationDate(analysis.createdAt)} · wersja modelu: {analysis.variantVersion}
        </span>
      </p>
      {isImpactStale(analysis.variantVersion, currentVersion) ? (
        <p className="text-sm text-amber-800 dark:text-amber-300">
          Analiza dotyczy wersji {analysis.variantVersion} modelu, aktualna wersja to {currentVersion}.
        </p>
      ) : null}

      <p className="whitespace-pre-wrap break-words text-sm">
        <span className="font-medium">Analizowana zmiana: </span>
        {describeChange(analysis.change)}
      </p>
      <p className="whitespace-pre-wrap break-words text-sm">
        <span className="font-medium">Podsumowanie: </span>
        {analysis.result.summary}
      </p>

      {affected.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Model nie wskazał innych dotkniętych bloków.</p>
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Bloki BMC dotknięte analizowaną zmianą</caption>
          <thead>
            <tr className="border-b border-zinc-300 dark:border-zinc-700">
              <th scope="col" className="py-2 pr-4 font-medium">
                Blok
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Wpływ
              </th>
              <th scope="col" className="py-2 font-medium">
                Opis
              </th>
            </tr>
          </thead>
          <tbody>
            {affected.map((item) => (
              <tr key={item.blockKey} className="border-b border-zinc-200 align-top dark:border-zinc-800">
                <th scope="row" className="py-2 pr-4 font-medium">
                  {BLOCK_INFO[item.blockKey].label}
                </th>
                <td className="py-2 pr-4 whitespace-nowrap">{IMPACT_LEVEL_LABELS[item.level]}</td>
                <td className="py-2 whitespace-pre-line break-words">{item.impact}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
