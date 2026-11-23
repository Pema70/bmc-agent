import type { BmcState } from "@/lib/schemas/bmc";

/** Pozycja listy załączników w kontekście: etykieta Z{n} (nie id z bazy), nazwa, typ, długość. Bez treści. */
export type AttachmentListEntry = { label: string; name: string; kind: string; textChars: number; truncated: boolean };

/**
 * Dane (nazwa, opis, stan BMC, w przyszłości załączniki) trafiają do promptu jako JSON w oznaczonych
 * blokach. Znak `<` jest zamieniany na `<` (poprawny zapis w JSON), więc żaden wpis nie może
 * zamknąć bloku ani otworzyć własnego, np. wstawiając `</bmc_state>`.
 */
export function escapeForPromptData(json: string): string {
  return json.replace(/</g, "\\u003c");
}

export function dataBlock(tag: string, value: unknown): string {
  return `<${tag}>\n${escapeForPromptData(JSON.stringify(value, null, 2))}\n</${tag}>`;
}

export function buildContext(
  project: { name: string; description: string },
  state: BmcState,
  attachments?: AttachmentListEntry[],
): string {
  const blocks = [
    dataBlock("project_data", { name: project.name, description: project.description }),
    dataBlock("bmc_state", state),
  ];
  // Lista załączników (nazwy i etykiety, bez treści) tylko w czacie; nazwa pliku jako wartość JSON, nigdy w prozie.
  if (attachments) {
    blocks.push(dataBlock("attachments", attachments));
  }
  return blocks.join("\n\n");
}
