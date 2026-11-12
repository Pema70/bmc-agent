/**
 * Wspólny licznik narzędzi wołających model w środku tury czatu (evaluate_bmc, analyze_impact):
 * w jednej turze najwyżej jedno z nich, liczy się każda próba, także nieudana. Tworzony per żądanie.
 */
export type HeavyToolGate = { tryAcquire: () => boolean };

export const HEAVY_TOOL_USED_MESSAGE =
  "W tej turze uruchomiono już ocenę modelu albo analizę wpływu (najwyżej jedna na turę). Nie ponawiaj, napisz użytkownikowi, co się stało.";

export function createHeavyToolGate(): HeavyToolGate {
  let used = false;
  return {
    // Ustawiane synchronicznie, bez await, więc równoległe wywołania w jednym kroku też są odrzucane.
    tryAcquire() {
      if (used) {
        return false;
      }
      used = true;
      return true;
    },
  };
}
