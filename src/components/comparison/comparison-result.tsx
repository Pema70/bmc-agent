import { AiProvenance } from "@/components/ai/ai-notice";
import {
  COMPARE_AI_LABEL,
  describeStale,
  staleVariants,
  variantDisplayNames,
} from "@/lib/comparison/presentation";
import { BLOCK_INFO } from "@/lib/schemas/bmc";
import { COMPARE_LABELS, type VariantComparisonSummary } from "@/lib/schemas/compare";

/**
 * Wynik porównania z modelu. Etykiety A/B/C w polach strukturalnych zamieniane są na nazwy wariantów z migawki
 * zapisanej w porównaniu (nie z bieżących nazw). Swobodny tekst modelu może nadal używać etykiet, więc nad wynikiem jest
 * legenda „A = nazwa”. Wszystko (podsumowanie, uwagi, zalety, wady, rekomendacja, nazwy) to węzły tekstowe React,
 * bez HTML i Markdown.
 */
export function ComparisonResult({
  comparison,
  current,
}: {
  comparison: VariantComparisonSummary;
  // Aktualne wersje wariantów (z serwera w chwili renderu), do znacznika „aktualna to M”.
  current: readonly { id: string; version: number }[];
}) {
  const names = variantDisplayNames(comparison.inputs);
  const labels = comparison.inputs.map((input) => input.label);
  const stale = staleVariants(comparison.inputs, current);
  const { result } = comparison;
  const assessments = labels.flatMap((label) => {
    const found = result.variants.find((variant) => variant.label === label);
    return found ? [found] : [];
  });
  const recommended = result.recommendation.label;

  return (
    <div className="flex flex-col gap-3">
      <AiProvenance
        label={COMPARE_AI_LABEL}
        provider={comparison.provider}
        model={comparison.model}
        promptVersion={comparison.promptVersion}
        createdAt={comparison.createdAt}
      />

      {stale.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm text-medium-fg">
          {stale.map((item) => (
            <li key={item.label}>{describeStale(item)}</li>
          ))}
        </ul>
      ) : null}

      <p className="text-xs text-muted">
        Etykiety w tekście modelu: {COMPARE_LABELS.filter((label) => labels.includes(label)).map((label) => `${label} = ${names[label]}`).join("; ")}.
      </p>

      <p className="whitespace-pre-wrap break-words text-sm">
        <span className="font-medium">Podsumowanie: </span>
        {result.summary}
      </p>

      {result.blockNotes.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-semibold">Uwagi do bloków</h4>
          <ul className="flex flex-col gap-1 text-sm">
            {result.blockNotes.map((note) => (
              <li key={note.blockKey} className="whitespace-pre-wrap break-words">
                <span className="font-medium">{BLOCK_INFO[note.blockKey].label}: </span>
                {note.comment}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-semibold">Zalety i wady wariantów</h4>
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {assessments.map((assessment) => (
            <li key={assessment.label} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border p-3 text-sm">
              <p className="font-semibold break-words">{names[assessment.label]}</p>
              <div>
                <p className="font-medium">Zalety</p>
                <ul className="list-disc pl-4 break-words">
                  {assessment.pros.map((point, index) => (
                    <li key={index}>{point}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium">Wady</p>
                <ul className="list-disc pl-4 break-words">
                  {assessment.cons.map((point, index) => (
                    <li key={index}>{point}</li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-1 rounded-xl border border-border p-3 text-sm">
        <h4 className="font-semibold">Rekomendacja</h4>
        <p className="font-medium break-words">
          {recommended === null || !names[recommended] ? "brak jednoznacznego wskazania" : `Wariant: ${names[recommended]}`}
        </p>
        <p className="whitespace-pre-wrap break-words">{result.recommendation.rationale}</p>
      </div>
    </div>
  );
}
