import { beforeEach, describe, expect, it, vi } from "vitest";

const { runEvaluation } = vi.hoisted(() => ({ runEvaluation: vi.fn() }));

vi.mock("@/lib/ai/evaluate", () => ({ runEvaluation }));

import { EVALUATE_ALREADY_USED_MESSAGE, createEvaluateBmcTool } from "@/lib/ai/tools/evaluate-bmc";
import { HEAVY_TOOL_USED_MESSAGE, createHeavyToolGate } from "@/lib/ai/tools/heavy-gate";

const context = { projectId: "p1", variantId: "v1", userId: "u1" };

const evaluation = {
  id: "ev-z-bazy",
  variantVersion: 4,
  result: { coherence: { score: 9, justification: "tajne uzasadnienie" } },
};

function run(input: unknown = {}, ctx = context, abortSignal?: AbortSignal) {
  const tool = createEvaluateBmcTool(ctx);
  return { tool, call: () => tool.execute!(input as never, { toolCallId: "c1", messages: [], abortSignal } as never) };
}

beforeEach(() => {
  vi.clearAllMocks();
  runEvaluation.mockResolvedValue({ ok: true, evaluation });
});

describe("evaluate_bmc", () => {
  it("nie ma argumentów od modelu: pusty obiekt jest poprawny, a dodatkowe pola są ignorowane", async () => {
    const { tool, call } = run({ state: "podrobiony", projectId: "p-obcy", variantId: "v-obcy" });

    expect(tool.inputSchema).toBeDefined();
    await call();

    expect(runEvaluation).toHaveBeenCalledTimes(1);
    expect(runEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", variantId: "v1", userId: "u1", trigger: "CHAT" }),
    );
    expect(JSON.stringify(runEvaluation.mock.calls[0][0])).not.toContain("podrobiony");
    expect(JSON.stringify(runEvaluation.mock.calls[0][0])).not.toContain("p-obcy");
  });

  it("modelowi wraca tylko { ok, evaluationId } z bazy, bez punktów i uzasadnień", async () => {
    const output = await run().call();

    expect(output).toEqual({ ok: true, evaluationId: "ev-z-bazy" });
    expect(JSON.stringify(output)).not.toContain("tajne");
  });

  it("przekazuje abortSignal żądania do oceny", async () => {
    const controller = new AbortController();

    await run({}, context, controller.signal).call();

    expect(runEvaluation).toHaveBeenCalledWith(expect.objectContaining({ abortSignal: controller.signal }));
  });

  it("błąd oceny wraca do modelu jako { ok: false, error } z polskim komunikatem", async () => {
    runEvaluation.mockResolvedValue({ ok: false, error: "PROVIDER", message: "Limit zapytań do modelu został chwilowo przekroczony." });

    const output = await run().call();

    expect(output).toEqual({ ok: false, error: "Limit zapytań do modelu został chwilowo przekroczony." });
  });

  it("druga próba w tej samej turze jest odrzucana bez wywołania oceny", async () => {
    const { call } = run();

    await call();
    const second = await call();

    expect(second).toEqual({ ok: false, error: EVALUATE_ALREADY_USED_MESSAGE });
    expect(runEvaluation).toHaveBeenCalledTimes(1);
  });

  it("limit liczy próby, nie sukcesy: po błędzie (429/503) nie ma ponowienia w tej turze", async () => {
    runEvaluation.mockResolvedValue({ ok: false, error: "PROVIDER", message: "Model jest chwilowo niedostępny." });
    const { call } = run();

    const first = await call();
    const second = await call();

    expect(first).toMatchObject({ ok: false, error: "Model jest chwilowo niedostępny." });
    expect(second).toEqual({ ok: false, error: EVALUATE_ALREADY_USED_MESSAGE });
    expect(runEvaluation).toHaveBeenCalledTimes(1);
  });

  it("równoległe wywołania w jednym kroku też uruchamiają ocenę najwyżej raz", async () => {
    const { call } = run();

    const results = await Promise.all([call(), call(), call()]);

    expect(runEvaluation).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => (r as { ok: boolean }).ok)).toHaveLength(1);
  });

  it("wspólny licznik: gdy inne ciężkie narzędzie zajęło turę, ocena jest odrzucana bez wywołania", async () => {
    const gate = createHeavyToolGate();
    gate.tryAcquire(); // np. analyze_impact w tej samej turze

    const output = await run({}, { ...context, gate } as never).call();

    expect(output).toEqual({ ok: false, error: HEAVY_TOOL_USED_MESSAGE });
    expect(output).toMatchObject({ error: expect.stringContaining("analizę wpływu") });
    expect(runEvaluation).not.toHaveBeenCalled();
  });

  it("wspólny licznik: ocena zajmuje turę dla drugiego narzędzia, także po błędzie", async () => {
    runEvaluation.mockResolvedValue({ ok: false, error: "PROVIDER", message: "Model jest chwilowo niedostępny." });
    const gate = createHeavyToolGate();

    await run({}, { ...context, gate } as never).call();

    expect(gate.tryAcquire()).toBe(false);
  });

  it("nowa tura (nowe narzędzie) może ocenić ponownie", async () => {
    await run().call();
    await run().call();

    expect(runEvaluation).toHaveBeenCalledTimes(2);
  });
});
