// Bezpieczniki bieżącego uruchomienia skryptu ewaluacji (plan 10f, punkt 22). Dotyczą tego uruchomienia, nie całej serii
// (wznowienie nie zatrzymuje się od razu). Sprawdzanie jest PO turze, więc jedna tura może przekroczyć limit
// (do `MAX_STEPS` kroków modelu); przerwanie następuje, gdy limit jest osiągnięty lub przekroczony.

export type BudgetStopCode = "COST_LIMIT" | "TURN_LIMIT" | "COST_UNKNOWN";
export type BudgetStop = { code: BudgetStopCode; message: string };

export type CostReading = { totalUsd: number; unknownCalls: number };

export class RunBudget {
  turns = 0;

  constructor(
    private readonly options: {
      maxCostUsd: number;
      maxTurns: number;
      /** Suma `costUsd` z `LlmCallLog` dla projektów utworzonych w tym uruchomieniu i liczba wywołań bez kosztu. */
      readCost: () => Promise<CostReading>;
    },
  ) {}

  /** Koszt: przerwanie, gdy suma osiągnęła limit albo któreś wywołanie ma nieznany koszt (`NULL`). */
  async checkCost(): Promise<BudgetStop | null> {
    const { totalUsd, unknownCalls } = await this.options.readCost();
    if (unknownCalls > 0) {
      return {
        code: "COST_UNKNOWN",
        message: `Przerwano: ${unknownCalls} wywołań w tym uruchomieniu ma nieznany koszt (model bez ceny w MODEL_PRICING lub brak tokenów), więc bezpiecznik kosztu nie jest wiarygodny.`,
      };
    }
    if (totalUsd >= this.options.maxCostUsd) {
      return {
        code: "COST_LIMIT",
        message: `Przerwano: koszt tego uruchomienia (${totalUsd.toFixed(6)} USD) osiągnął limit ${this.options.maxCostUsd} USD (--max-koszt-usd). Jedna tura może przekroczyć limit, bo sprawdzanie jest po turze.`,
      };
    }
    return null;
  }

  /** Po zakończonej turze czatu: zlicza turę, potem sprawdza limit tur i koszt. */
  async afterTurn(): Promise<BudgetStop | null> {
    this.turns += 1;
    const cost = await this.checkCost();
    if (cost) return cost;
    if (this.turns >= this.options.maxTurns) {
      return {
        code: "TURN_LIMIT",
        message: `Przerwano: wykonano ${this.turns} tur czatu w tym uruchomieniu, co osiąga limit ${this.options.maxTurns} (--max-tur).`,
      };
    }
    return null;
  }
}
