/**
 * Plakietka na przycisku (liczba, „nieaktualna”, „runda 1 z 3”). Widoczny tekst jest krótki; pełny opis dla czytników ekranu
 * (`description`) jest osobnym, ukrytym wizualnie tekstem, a widoczny tekst jest dla nich ukryty, żeby nie czytać go dwa razy.
 */
export function Badge({ text, description }: { text: string; description?: string }) {
  return (
    <span className="inline-flex min-w-5 items-center justify-center rounded-full border border-border bg-tint px-2 text-xs font-bold text-text">
      <span aria-hidden={description ? "true" : undefined}>{text}</span>
      {description ? <span className="sr-only">{description}</span> : null}
    </span>
  );
}
