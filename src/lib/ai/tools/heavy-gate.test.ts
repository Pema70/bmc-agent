import { describe, expect, it } from "vitest";
import { createHeavyToolGate } from "@/lib/ai/tools/heavy-gate";

describe("createHeavyToolGate", () => {
  it("pozwala na jedną próbę, kolejne odrzuca", () => {
    const gate = createHeavyToolGate();
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);
    expect(gate.tryAcquire()).toBe(false);
  });

  it("każda tura (nowa bramka) zaczyna od zera", () => {
    expect(createHeavyToolGate().tryAcquire()).toBe(true);
    expect(createHeavyToolGate().tryAcquire()).toBe(true);
  });
});
