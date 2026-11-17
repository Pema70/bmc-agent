import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ComparisonPanel } from "@/components/comparison/comparison-panel";
import { StateComparisonView, type ComparedColumn } from "@/components/comparison/state-comparison";
import { hasRole, requireProjectRole } from "@/lib/auth/permissions";
import { compareStates } from "@/lib/bmc/compare";
import { filterHistoryBySet, parseCompareParams } from "@/lib/comparison/presentation";
import { listVariantComparisons } from "@/lib/db/comparisons";
import { getProject } from "@/lib/db/projects";
import { getVariantsForCompare, listVariants } from "@/lib/db/variants";

const HISTORY_SHOWN = 20;

export const metadata: Metadata = { title: "Porównanie wariantów" };

export default async function ComparisonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ w?: string | string[] }>;
}) {
  const { id } = await params;
  const { w } = await searchParams;

  // Rola VIEWER przed jakimkolwiek odczytem danych projektu (brak sesji: przekierowanie, obcy projekt: 404).
  const access = await requireProjectRole(id, "VIEWER");
  if (!access.ok) {
    notFound();
  }

  // Poprawny kształt to 2-3 różne id (parametr w może się powtarzać); inaczej 404.
  const parsed = parseCompareParams(w);
  if (!parsed.ok) {
    notFound();
  }

  const project = await getProject(access.projectId);
  if (!project) {
    notFound();
  }

  // Zapisane stany wariantów, jednym zapytaniem po projectId i liście id (jak w runCompareVariants). Obcy lub
  // nieistniejący wariant = mniej wyników niż żądanych = 404.
  const found = await getVariantsForCompare(access.projectId, parsed.ids);
  if (found.length !== parsed.ids.length) {
    notFound();
  }
  const listed = await listVariants(access.projectId);
  const meta = new Map(listed.map((variant) => [variant.id, variant]));

  const columns: ComparedColumn[] = found.map((variant) => ({
    id: variant.id,
    name: variant.name,
    version: variant.version,
    isMain: meta.get(variant.id)?.isMain ?? false,
    origin: meta.get(variant.id)?.origin ?? "MANUAL",
    state: variant.state,
  }));
  const comparison = compareStates(columns.map((column) => column.state));

  // Historia porównań projektu (ostatnie 20, bez stanów), zawężona do tego zestawu wariantów.
  const history = filterHistoryBySet(await listVariantComparisons(access.projectId, HISTORY_SHOWN), parsed.ids);

  return (
    <main className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-2">
        <Link href={`/projekty/${access.projectId}`} className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
          ← Wróć do projektu
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight break-words">Porównanie wariantów</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 break-words">Projekt: {project.name}</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Porównanie dotyczy zapisanych stanów wariantów; niezapisane zmiany w edytorze nie są uwzględniane.
        </p>
      </header>

      <section className="flex flex-col gap-4" aria-labelledby="diff-heading">
        <h2 id="diff-heading" className="text-lg font-semibold">
          Różnice we wpisach
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Różnice wylicza aplikacja (porównanie dosłownego tekstu wpisów, nie ich znaczenia), względem pierwszego wariantu.
          Przeredagowany wpis jest pokazany jako „− brak” i „+ dodano”.
        </p>
        <StateComparisonView columns={columns} comparison={comparison} />
      </section>

      <ComparisonPanel
        // Bez key zależnego od listy: nowe porównania dołącza sam z props initialItems (bez remountu).
        projectId={access.projectId}
        variantIds={parsed.ids}
        current={columns.map((column) => ({ id: column.id, version: column.version }))}
        canCompare={hasRole(access.role, "EDITOR")}
        initialItems={history}
      />
    </main>
  );
}
