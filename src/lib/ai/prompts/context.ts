import type { BmcState } from "@/lib/schemas/bmc";

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

export function buildContext(project: { name: string; description: string }, state: BmcState): string {
  return [
    dataBlock("project_data", { name: project.name, description: project.description }),
    dataBlock("bmc_state", state),
  ].join("\n\n");
}
