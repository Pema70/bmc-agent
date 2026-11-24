import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getVariantDetails: vi.fn(), getProject: vi.fn(), listEvaluationsForVariant: vi.fn() }));

vi.mock("@/lib/db/variants", () => ({ getVariantDetails: mocks.getVariantDetails }));
vi.mock("@/lib/db/projects", () => ({ getProject: mocks.getProject }));
vi.mock("@/lib/db/evaluations", () => ({ listEvaluationsForVariant: mocks.listEvaluationsForVariant }));

import { loadCanvasExportData } from "@/lib/export/canvas-data";
import { evaluationView } from "@/lib/export/test-fixtures";
import { BLOCK_KEYS, emptyBmcState } from "@/lib/schemas/bmc";

const NOW = new Date("2026-11-25T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getVariantDetails.mockResolvedValue({
    id: "v1",
    name: "Wariant\u0000 główny",
    isMain: true,
    origin: "MANUAL",
    description: null,
    version: 4,
    createdAt: NOW,
    updatedAt: NOW,
    state: { ...emptyBmcState(), channels: ["Sklep‮ online", "Targi"] },
  });
  mocks.getProject.mockResolvedValue({ id: "p1", name: "Kawiarnia\u0007 Ziarno", description: "x" });
  mocks.listEvaluationsForVariant.mockResolvedValue([]);
});

describe("loadCanvasExportData", () => {
  it("odczyty tylko po projekcie z uprawnień i wariancie; najnowsza ocena to jedna pozycja listy", async () => {
    await loadCanvasExportData("p1", "v1", NOW);

    expect(mocks.getVariantDetails).toHaveBeenCalledWith("p1", "v1");
    expect(mocks.getProject).toHaveBeenCalledWith("p1");
    expect(mocks.listEvaluationsForVariant).toHaveBeenCalledWith("p1", "v1", 1);
  });

  it("wariant spoza projektu: null, bez dalszych odczytów", async () => {
    mocks.getVariantDetails.mockResolvedValue(null);

    expect(await loadCanvasExportData("p1", "v-obcy", NOW)).toBeNull();
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(mocks.listEvaluationsForVariant).not.toHaveBeenCalled();
  });

  it("brak projektu: null", async () => {
    mocks.getProject.mockResolvedValue(null);

    expect(await loadCanvasExportData("p1", "v1", NOW)).toBeNull();
  });

  it("zwraca dziewięć bloków w kolejności BLOCK_KEYS z oczyszczonymi tekstami", async () => {
    const data = await loadCanvasExportData("p1", "v1", NOW);

    expect(data?.blocks.map((block) => block.blockKey)).toEqual([...BLOCK_KEYS]);
    expect(data?.blocks.find((block) => block.blockKey === "channels")).toMatchObject({ title: "Kanały", entries: ["Sklep online", "Targi"] });
    expect(data?.projectName).toBe("Kawiarnia Ziarno");
    expect(data?.variantName).toBe("Wariant główny");
    expect(data?.variantVersion).toBe(4);
  });

  it("oceny: czytelna daje ocenę z flagą nieaktualności, brak oceny i nieczytelny zapis są rozróżnione", async () => {
    mocks.listEvaluationsForVariant.mockResolvedValueOnce([{ ok: true, evaluation: evaluationView({ variantVersion: 2 }) }]);
    const withEvaluation = await loadCanvasExportData("p1", "v1", NOW);
    mocks.listEvaluationsForVariant.mockResolvedValueOnce([{ ok: false, id: "e1", error: "x" }]);
    const unreadable = await loadCanvasExportData("p1", "v1", NOW);
    const none = await loadCanvasExportData("p1", "v1", NOW);

    expect(withEvaluation?.evaluation).toMatchObject({ isAi: true, stale: true, evaluatedVersion: 2 });
    expect(withEvaluation?.evaluationUnreadable).toBe(false);
    expect(unreadable).toMatchObject({ evaluation: null, evaluationUnreadable: true });
    expect(none).toMatchObject({ evaluation: null, evaluationUnreadable: false });
  });
});
