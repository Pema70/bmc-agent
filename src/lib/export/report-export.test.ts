import { describe, expect, it } from "vitest";
import { buildReportExport } from "@/lib/export/report-export";
import { HOSTILE_NAME, reportData } from "@/lib/export/report-fixtures";
import { MANUAL_EDIT_NOTE, SOURCE_LEGEND_NOTE } from "@/lib/report/labels";

describe("buildReportExport", () => {
  const model = buildReportExport(reportData());

  it("płótno ma kod źródła przy każdym wpisie (wszystkie rodzaje, w tym nieznane)", () => {
    const codes = new Map(model.canvas.flatMap((block) => block.entries.map((entry) => [entry.text, entry.code] as const)));

    expect(codes.get("Studenci krakowskich uczelni")).toBe("R");
    expect(codes.get("Sprzedaż w sklepie internetowym")).toBe("Rz");
    expect(codes.get("Współpraca z piekarnią")).toBe("Z");
    expect(codes.get("Palarnia własna")).toBe("P");
    expect(codes.get("Kawa ekologiczna")).toBe("W");
    expect(codes.get("Subskrypcja miesięczna")).toBe("Rz"); // ustalone po tekście z propozycji rozmowy
    expect(codes.get("Wpis o nieznanym źródle")).toBe("?");
  });

  it("tabela źródeł ma pełne etykiety i pewność; podsumowanie liczy trzy grupy", () => {
    const row = (text: string) => model.sourceRows.find((item) => item.text === text);

    expect(row("Studenci krakowskich uczelni")).toMatchObject({ label: "ręczny (tekst użytkownika)", certainty: "zapisane" });
    expect(row("Palarnia własna")?.label).toContain("runda 1, pytanie 1");
    expect(row("Kawa ekologiczna")?.label).toContain("niezweryfikowana");
    expect(row("Subskrypcja miesięczna")).toMatchObject({ certainty: "ustalone po tekście (prawdopodobne)" });
    expect(row("Subskrypcja miesięczna")?.label).toContain("ustalone po tekście");
    expect(row("Wpis o nieznanym źródle")).toMatchObject({ label: "źródło nieznane", certainty: "nieznane" });
    expect(model.sourceSummary).toContain("zapisane: 5");
    expect(model.sourceSummary).toContain("nieznane: 2");
  });

  it("żaden rodzaj propozycji AI nie jest nazwany ręcznym; legenda i uwaga o ręcznej edycji są w modelu", () => {
    for (const row of model.sourceRows.filter((item) => item.code !== "R" && item.code !== "?")) {
      expect(row.label).not.toContain("ręczny");
    }
    expect(model.legendNote).toBe(SOURCE_LEGEND_NOTE);
    expect(model.notes).toContain(MANUAL_EDIT_NOTE);
  });

  it("opisy bloków: uzasadnienie agenta z pozycją w rundzie; wpisy bez uzasadnienia są jawne", () => {
    const resources = model.blocks.find((block) => block.title === "Kluczowe zasoby");
    const segments = model.blocks.find((block) => block.title === "Segmenty klientów");

    expect(resources?.entries[0]).toMatchObject({ rationale: "Użytkownik potwierdził własną palarnię.", position: "runda 1, pytanie 1" });
    expect(segments?.withoutRationale).toBe(2);
  });

  it("załączniki: nazwa jako zwykły tekst, użycie i obcięcie", () => {
    expect(model.attachments[0]).toMatchObject({ name: HOSTILE_NAME, usage: "użyty jako źródło wpisu", size: "20 KB" });
    expect(model.attachments[1]).toMatchObject({ usage: "wgrany, niewykorzystany", chars: "700 (obcięty)" });
  });

  it("runda poprawek: ocena przed i po z punktami, odpowiedzi 1-based", () => {
    const round = model.rounds[0];

    expect(round.questions[0]).toMatchObject({ number: 1, answer: "Tak, od roku" });
    expect(round.questions[1].answer).toBe("(brak odpowiedzi)");
    expect(round.before).toContain("Spójność: 8");
    expect(round.after).toContain("Spójność: 9");
  });

  it("brak danych: puste listy zamiast wyjątków", () => {
    const empty = buildReportExport(
      reportData({
        evaluations: { items: [], truncated: false, limit: 20 },
        rounds: [],
        impacts: { items: [], truncated: false, limit: 20 },
        comparisons: { items: [], truncated: false, limit: 10 },
        llmSummary: [],
      }),
    );

    expect(empty.latestEvaluation).toBeNull();
    expect(empty.rounds).toEqual([]);
    expect(empty.impacts).toEqual([]);
    expect(empty.models).toEqual([]);
  });

  it("obcięte listy dostają adnotację „pokazano najnowsze N”, nieczytelne zapisy są policzone", () => {
    const base = reportData();
    const truncated = buildReportExport({
      ...base,
      evaluations: { items: [...base.evaluations.items, { ok: false, id: "bad", error: "x" }], truncated: true, limit: 20 },
      impacts: { ...base.impacts, truncated: true },
      comparisons: { ...base.comparisons, truncated: true },
      proposalsTruncated: true,
    });

    expect(truncated.evaluationNotes.join(" ")).toContain("pokazano najnowsze 20");
    expect(truncated.evaluationNotes.join(" ")).toContain("nieczytelne zapisy ocen");
    expect(truncated.impactNotes.join(" ")).toContain("pokazano najnowsze 20");
    expect(truncated.comparisonNotes.join(" ")).toContain("pokazano najnowsze 10");
    expect(truncated.notes.join(" ")).toContain("Lista propozycji");
  });

  it("analizy i porównania są oznaczone AI z modelem i wersją promptu; identyfikatory nie wchodzą do modelu", () => {
    expect(model.impacts[0].heading).toContain("(AI)");
    expect(model.impacts[0].meta).toContain("impact-v1");
    expect(model.comparisons[0].heading).toContain("(AI)");
    expect(model.comparisons[0].recommendation).toContain("Rekomendowany wariant: A");
    const json = JSON.stringify(model);
    for (const id of ["pr-chat", "pr-att", '"v1"', '"v2"']) {
      expect(json).not.toContain(id);
    }
  });

  it("teksty z bazy są oczyszczone (znaki sterujące i kierunku)", () => {
    const hostile = buildReportExport(reportData({ project: { name: "Kaw\u0000iarnia‮", description: "A\u0007B" } }));

    expect(hostile.projectName).toBe("Kawiarnia");
    expect(hostile.projectDescription).toBe("AB");
  });
});
