import { VARIANT_NAME_MAX_LENGTH } from "@/lib/schemas/variant";

const COPY_SUFFIX = /\s+\(kopia(?: \d+)?\)$/;

function withSuffix(base: string, suffix: string): string {
  const room = VARIANT_NAME_MAX_LENGTH - suffix.length;
  return `${base.slice(0, Math.max(1, room)).trimEnd()}${suffix}`;
}

/**
 * Nazwa kopii nadawana przez serwer: „<nazwa> (kopia)”, potem „(kopia 2)”, „(kopia 3)”…
 * Kopia kopii nie składa przyrostków („X (kopia)” → „X (kopia 2)”). Nazwy nie muszą być unikalne w projekcie,
 * ale kopia dostaje pierwszy numer, którego nikt jeszcze nie ma. Całość mieści się w VARIANT_NAME_MAX_LENGTH.
 */
export function nextCopyName(sourceName: string, existingNames: readonly string[]): string {
  const base = sourceName.replace(COPY_SUFFIX, "").trim() || sourceName.trim();
  const taken = new Set(existingNames);
  for (let n = 1; ; n += 1) {
    const candidate = withSuffix(base, n === 1 ? " (kopia)" : ` (kopia ${n})`);
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}
