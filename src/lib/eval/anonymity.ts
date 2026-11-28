/**
 * Normalizacja do porównań: małe litery, bez znaków diakrytycznych (także „ł”), znaki inne niż litery i cyfry
 * zamienione na spacje. Dzięki temu „Spotify’a”, „SPOTIFY” i „Spótify” trafiają w ten sam token.
 */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Zwraca zakazane tokeny znalezione w tekście. Tokeny co najmniej 5-znakowe liczą się także jako część słowa
 * (polskie końcówki: „Netflixa”), krótsze tylko jako całe słowo (żeby nie łapać przypadkowych podciągów).
 */
export function findForbiddenTokens(text: string, tokens: readonly string[]): string[] {
  const haystack = ` ${normalizeForMatch(text)} `;
  return tokens.filter((token) => {
    const needle = normalizeForMatch(token);
    if (!needle) return false;
    return needle.length >= 5 ? haystack.includes(needle) : haystack.includes(` ${needle} `);
  });
}
