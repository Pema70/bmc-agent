export type StateTone = "ai" | "low" | "medium" | "high" | "main";

// Pełne nazwy klas (Tailwind generuje je tylko z literałów).
const TONES: Record<StateTone, string> = {
  ai: "border-ai-border bg-ai-bg text-ai-fg",
  low: "border-low-border bg-low-bg text-low-fg",
  medium: "border-medium-border bg-medium-bg text-medium-fg",
  high: "border-high-border bg-high-bg text-high-fg",
  main: "border-main-border bg-main-bg text-main-fg",
};

/**
 * Znacznik stanu (propozycja AI, wpływ niski/średni/wysoki, „Główny”, „Strategia AI”). Zawsze ma etykietę tekstową, więc
 * znaczenie nie zależy od samego koloru; ramka i pogrubienie odróżniają go od przycisków. Etykieta to zwykły tekst.
 */
export function StateChip({ tone, label }: { tone: StateTone; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.8125rem] font-bold whitespace-nowrap ${TONES[tone]}`}>
      {label}
    </span>
  );
}
