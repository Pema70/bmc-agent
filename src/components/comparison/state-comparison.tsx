import type { BlockComparison, StateComparison } from "@/lib/bmc/compare";
import { BLOCK_INFO, BLOCK_KEYS, type BmcState } from "@/lib/schemas/bmc";
import type { VariantOrigin } from "@/lib/schemas/variant";
import { variantBadges } from "@/lib/variants/presentation";

export type ComparedColumn = {
  id: string;
  name: string;
  version: number;
  isMain: boolean;
  origin: VariantOrigin;
  state: BmcState;
};

// Klasy muszą być zapisane jawnie (Tailwind nie widzi składanych nazw).
const GRID_COLUMNS = { 2: "md:grid-cols-2", 3: "md:grid-cols-3" } as const;

const badgeClass =
  "rounded border border-zinc-500 px-1.5 py-0.5 text-xs font-semibold text-zinc-800 dark:border-zinc-400 dark:text-zinc-200";

function gridClass(count: number): string {
  return `grid gap-3 ${count === 3 ? GRID_COLUMNS[3] : GRID_COLUMNS[2]}`;
}

/**
 * Różnice we wpisach liczone przez aplikację (compareStates), bez modelu. Kolumny obok siebie od szerokości md, na wąskim
 * ekranie jedna pod drugą (nazwa wariantu powtarza się wtedy nad każdą komórką). Różnice niosą tekst i symbol
 * („+ dodano”, „− brak”) oraz styl tekstu (podkreślenie, przekreślenie), nie tylko kolor. Wszystkie treści to węzły
 * tekstowe React (nazwy wariantów i wpisy pochodzą od użytkownika lub od modelu), bez HTML i Markdown.
 */
export function StateComparisonView({ columns, comparison }: { columns: ComparedColumn[]; comparison: StateComparison }) {
  const [reference] = columns;
  if (!reference) {
    return null;
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-0 flex-col gap-4">
        <div className={`hidden ${gridClass(columns.length)} md:grid`}>
          {columns.map((column, index) => {
            const totals = index === 0 ? null : comparison.others[index - 1]?.totals;
            return (
              <div key={column.id} className="flex min-w-0 flex-col gap-1 rounded-md border border-zinc-300 p-3 dark:border-zinc-700">
                <ColumnHeader column={column} reference={index === 0} />
                {totals ? (
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    wspólnych: {totals.shared} · + dodano: {totals.added} · − brak: {totals.missing}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        {BLOCK_KEYS.map((key) => (
          <section key={key} aria-labelledby={`compare-block-${key}`} className="flex flex-col gap-2">
            <h3 id={`compare-block-${key}`} className="text-sm font-semibold">
              {BLOCK_INFO[key].label}
            </h3>
            <div className={gridClass(columns.length)}>
              {columns.map((column, index) => (
                <div key={column.id} className="flex min-w-0 flex-col gap-1 rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-800">
                  <p className="text-xs font-medium text-zinc-600 md:hidden dark:text-zinc-400">
                    {column.name}
                    {index === 0 ? " (odniesienie)" : ""}
                  </p>
                  {index === 0 ? (
                    <EntryList entries={reference.state[key]} />
                  ) : (
                    <DiffList block={comparison.others[index - 1]?.blocks[key]} />
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ColumnHeader({ column, reference }: { column: ComparedColumn; reference: boolean }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="min-w-0 break-words font-semibold">{column.name}</span>
        {variantBadges(column).map((badge) => (
          <span key={badge} className={badgeClass}>
            {badge}
          </span>
        ))}
        {reference ? <span className={badgeClass}>Odniesienie</span> : null}
      </div>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Wersja {column.version}</p>
    </>
  );
}

function EntryList({ entries }: { entries: readonly string[] }) {
  if (entries.length === 0) {
    return <p className="text-zinc-400 italic">Brak wpisów.</p>;
  }
  return (
    <ul className="flex list-disc flex-col gap-1 pl-4 break-words">
      {entries.map((entry, index) => (
        <li key={index}>{entry}</li>
      ))}
    </ul>
  );
}

function DiffList({ block }: { block: BlockComparison | undefined }) {
  if (!block || block.shared.length + block.added.length + block.missing.length === 0) {
    return <p className="text-zinc-400 italic">Brak wpisów.</p>;
  }
  return (
    <ul className="flex flex-col gap-1 break-words">
      {block.shared.map((entry, index) => (
        <li key={`s${index}`} className="list-disc ml-4">
          {entry}
        </li>
      ))}
      {block.added.map((entry, index) => (
        <li key={`a${index}`}>
          <span className="rounded bg-green-100 px-1 text-green-900 underline decoration-2 underline-offset-2 dark:bg-green-950/50 dark:text-green-200">
            <span className="mr-1 font-semibold no-underline">+ dodano:</span>
            {entry}
          </span>
        </li>
      ))}
      {block.missing.map((entry, index) => (
        <li key={`m${index}`}>
          <span className="rounded bg-red-100 px-1 text-red-900 line-through dark:bg-red-950/50 dark:text-red-200">
            <span className="mr-1 font-semibold no-underline">− brak:</span>
            {entry}
          </span>
        </li>
      ))}
    </ul>
  );
}
