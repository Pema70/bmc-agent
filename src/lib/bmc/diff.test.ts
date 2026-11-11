import { describe, expect, it } from "vitest";
import { countPendingByBlock, proposalDiffForBlock } from "@/lib/bmc/diff";
import { MAX_ENTRIES_PER_BLOCK, emptyBmcState } from "@/lib/schemas/bmc";
import type { ProposalItem } from "@/lib/schemas/proposal";

const state = { ...emptyBmcState(), channels: ["Sklep online", "Targi", "Poczta"], revenue_streams: ["Sprzedaż"] };

let counter = 0;
function proposal(partial: Partial<ProposalItem>): ProposalItem {
  counter += 1;
  return {
    id: `pr${counter}`,
    blockKey: "channels",
    operation: "add",
    before: null,
    after: null,
    rationale: "Uzasadnienie",
    status: "PENDING",
    ...partial,
  };
}

describe("proposalDiffForBlock", () => {
  it("bez propozycji wszystkie wpisy są niezmienione", () => {
    const diff = proposalDiffForBlock(state, "channels", []);

    expect(diff.entries.map((e) => [e.text, e.status])).toEqual([
      ["Sklep online", "unchanged"],
      ["Targi", "unchanged"],
      ["Poczta", "unchanged"],
    ]);
    expect(diff.additions).toEqual([]);
    expect(diff.stale).toEqual([]);
  });

  it("oznacza wpis do usunięcia, wpis do zmiany i dodawany wpis", () => {
    const remove = proposal({ operation: "remove", before: "Targi" });
    const edit = proposal({ operation: "edit", before: "Poczta", after: "Poczta kurierska" });
    const add = proposal({ operation: "add", after: "Social media" });

    const diff = proposalDiffForBlock(state, "channels", [remove, edit, add]);

    expect(diff.entries.map((e) => e.status)).toEqual(["unchanged", "removed", "edited"]);
    expect(diff.entries[1].proposals).toEqual([remove]);
    expect(diff.entries[2].proposals).toEqual([edit]);
    expect(diff.additions).toEqual([add]);
    expect(diff.stale).toEqual([]);
  });

  it("obsługuje wiele propozycji w jednym bloku i zachowuje ich kolejność", () => {
    const first = proposal({ operation: "add", after: "Pierwszy" });
    const second = proposal({ operation: "add", after: "Drugi" });
    const editA = proposal({ operation: "edit", before: "Sklep online", after: "Sklep internetowy" });
    const removeB = proposal({ operation: "remove", before: "Poczta" });

    const diff = proposalDiffForBlock(state, "channels", [first, editA, second, removeB]);

    expect(diff.additions.map((p) => p.after)).toEqual(["Pierwszy", "Drugi"]);
    expect(diff.entries.map((e) => e.status)).toEqual(["edited", "unchanged", "removed"]);
  });

  it("dwie propozycje do tego samego wpisu: usunięcie ma pierwszeństwo, obie są dołączone", () => {
    const edit = proposal({ operation: "edit", before: "Targi", after: "Targi branżowe" });
    const remove = proposal({ operation: "remove", before: "Targi" });

    const forward = proposalDiffForBlock(state, "channels", [edit, remove]);
    const backward = proposalDiffForBlock(state, "channels", [remove, edit]);

    expect(forward.entries[1].status).toBe("removed");
    expect(backward.entries[1].status).toBe("removed");
    expect(forward.entries[1].proposals).toEqual([edit, remove]);
    expect(backward.entries[1].proposals).toEqual([remove, edit]);
  });

  describe("propozycje nieaktualne", () => {
    it("zmiana lub usunięcie nieistniejącego wpisu jest nieaktualna (STALE) i nie oznacza żadnego wpisu", () => {
      const edit = proposal({ operation: "edit", before: "Nie ma takiego", after: "x" });
      const remove = proposal({ operation: "remove", before: "Też nie ma" });

      const diff = proposalDiffForBlock(state, "channels", [edit, remove]);

      expect(diff.stale).toEqual([
        { proposal: edit, reason: "STALE" },
        { proposal: remove, reason: "STALE" },
      ]);
      expect(diff.entries.every((e) => e.status === "unchanged" && e.proposals.length === 0)).toBe(true);
      expect(diff.additions).toEqual([]);
    });

    it("dodanie wpisu, który już istnieje, jest nieaktualne (DUPLICATE)", () => {
      const add = proposal({ operation: "add", after: "Targi" });

      const diff = proposalDiffForBlock(state, "channels", [add]);

      expect(diff.stale).toEqual([{ proposal: add, reason: "DUPLICATE" }]);
      expect(diff.additions).toEqual([]);
    });

    it("dodanie ponad limit bloku jest nieaktualne (LIMIT)", () => {
      const full = {
        ...emptyBmcState(),
        channels: Array.from({ length: MAX_ENTRIES_PER_BLOCK }, (_, i) => `Kanał ${i + 1}`),
      };
      const add = proposal({ operation: "add", after: "Nowy" });

      expect(proposalDiffForBlock(full, "channels", [add]).stale).toEqual([{ proposal: add, reason: "LIMIT" }]);
    });

    it("po zmianie stanu ta sama propozycja przestaje być aktualna", () => {
      const remove = proposal({ operation: "remove", before: "Targi" });
      const after = { ...state, channels: ["Sklep online", "Poczta"] };

      expect(proposalDiffForBlock(state, "channels", [remove]).stale).toEqual([]);
      expect(proposalDiffForBlock(after, "channels", [remove]).stale).toEqual([{ proposal: remove, reason: "STALE" }]);
    });

    it("aktualne propozycje obok nieaktualnych są oznaczone poprawnie", () => {
      const good = proposal({ operation: "remove", before: "Targi" });
      const bad = proposal({ operation: "edit", before: "Nie ma takiego", after: "x" });

      const diff = proposalDiffForBlock(state, "channels", [bad, good]);

      expect(diff.entries[1].proposals).toEqual([good]);
      expect(diff.stale.map((s) => s.proposal)).toEqual([bad]);
    });
  });

  it("pomija propozycje innych bloków i już rozpatrzone", () => {
    const otherBlock = proposal({ blockKey: "revenue_streams", operation: "remove", before: "Sprzedaż" });
    const accepted = proposal({ operation: "remove", before: "Targi", status: "ACCEPTED" });
    const rejected = proposal({ operation: "add", after: "Nowy", status: "REJECTED" });

    const diff = proposalDiffForBlock(state, "channels", [otherBlock, accepted, rejected]);

    expect(diff.entries.every((e) => e.status === "unchanged")).toBe(true);
    expect(diff.additions).toEqual([]);
    expect(diff.stale).toEqual([]);
  });

  it("przy duplikatach wpisów propozycja dotyczy pierwszego pasującego", () => {
    const withDuplicates = { ...emptyBmcState(), channels: ["A", "B", "A"] };
    const remove = proposal({ operation: "remove", before: "A" });

    const diff = proposalDiffForBlock(withDuplicates, "channels", [remove]);

    expect(diff.entries.map((e) => e.status)).toEqual(["removed", "unchanged", "unchanged"]);
  });

  it("zwraca tyle wpisów, ile ma blok, i nie zmienia argumentów", () => {
    const stateSnapshot = JSON.stringify(state);
    const items = [proposal({ operation: "remove", before: "Targi" })];
    const itemsSnapshot = JSON.stringify(items);

    const diff = proposalDiffForBlock(state, "channels", items);

    expect(diff.entries).toHaveLength(state.channels.length);
    expect(JSON.stringify(state)).toBe(stateSnapshot);
    expect(JSON.stringify(items)).toBe(itemsSnapshot);
  });

  it("treść propozycji jest przekazywana bez zmian (renderowanie jako zwykły tekst)", () => {
    const html = proposal({ operation: "add", after: "<img src=x onerror=alert(1)>", rationale: "<b>pogrubione</b>" });

    const diff = proposalDiffForBlock(state, "channels", [html]);

    expect(diff.additions[0].after).toBe("<img src=x onerror=alert(1)>");
    expect(diff.additions[0].rationale).toBe("<b>pogrubione</b>");
  });
});

describe("countPendingByBlock", () => {
  it("liczy tylko oczekujące propozycje w każdym bloku", () => {
    const items = [
      proposal({ operation: "add", after: "a" }),
      proposal({ operation: "add", after: "b" }),
      proposal({ blockKey: "revenue_streams", operation: "add", after: "c" }),
      proposal({ operation: "add", after: "d", status: "ACCEPTED" }),
    ];

    expect(countPendingByBlock(items)).toEqual({ channels: 2, revenue_streams: 1 });
  });
});
