import { CRITERION_LABELS, EVALUATION_CRITERIA, SCORE_MAX, type EvaluationOutput } from "@/lib/schemas/evaluation";

// Uzasadnienia pochodzą od modelu: renderowane wyłącznie jako węzły tekstowe React.
export function EvaluationTable({ result }: { result: EvaluationOutput }) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">Oceny kryteriów modelu BMC w skali 1-{SCORE_MAX}</caption>
      <thead>
        <tr className="border-b border-zinc-300 dark:border-zinc-700">
          <th scope="col" className="py-2 pr-4 font-medium">
            Kryterium
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            Ocena
          </th>
          <th scope="col" className="py-2 font-medium">
            Uzasadnienie
          </th>
        </tr>
      </thead>
      <tbody>
        {EVALUATION_CRITERIA.map((criterion) => (
          <tr key={criterion} className="border-b border-zinc-200 align-top dark:border-zinc-800">
            <th scope="row" className="py-2 pr-4 font-medium">
              {CRITERION_LABELS[criterion]}
            </th>
            <td className="py-2 pr-4 whitespace-nowrap">
              {result[criterion].score}/{SCORE_MAX}
            </td>
            <td className="py-2 whitespace-pre-line">{result[criterion].justification}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
