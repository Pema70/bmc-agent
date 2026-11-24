import { describe, expect, it } from "vitest";
import {
  PANEL_IDS,
  PANEL_TITLES,
  TOOLBAR_LABELS,
  TOOLBAR_ORDER,
  availablePanels,
  nextToolbarIndex,
  parseChatParam,
  parsePanelParam,
  pendingProposalsText,
  toolbarBadges,
  withUiParams,
  type ToolbarBadgeInput,
} from "@/lib/ui/panels";

describe("availablePanels", () => {
  it("EDITOR z wariantem: wszystkie siedem paneli", () => {
    expect(availablePanels({ hasVariant: true, canEditCanvas: true })).toEqual([...PANEL_IDS]);
  });

  it("VIEWER (bez edycji): bez cyklu poprawek; bez wariantu: tylko załączniki", () => {
    expect(availablePanels({ hasVariant: true, canEditCanvas: false })).not.toContain("poprawki");
    expect(availablePanels({ hasVariant: true, canEditCanvas: false })).toHaveLength(PANEL_IDS.length - 1);
    expect(availablePanels({ hasVariant: false, canEditCanvas: true })).toEqual(["zalaczniki"]);
  });
});

describe("parsePanelParam", () => {
  const all = availablePanels({ hasVariant: true, canEditCanvas: true });

  it("przyjmuje wartości z allowlisty dozwolone dla widoku", () => {
    expect(parsePanelParam("ocena", all)).toBe("ocena");
    expect(parsePanelParam("eksport", all)).toBe("eksport");
  });

  it("ignoruje wartości obce, puste, powtórzone i niedozwolone dla roli (bez błędu)", () => {
    expect(parsePanelParam("<script>", all)).toBeNull();
    expect(parsePanelParam("", all)).toBeNull();
    expect(parsePanelParam(undefined, all)).toBeNull();
    expect(parsePanelParam(["ocena", "wplyw"], all)).toBeNull();
    expect(parsePanelParam("OCENA", all)).toBeNull();
    expect(parsePanelParam("poprawki", availablePanels({ hasVariant: true, canEditCanvas: false }))).toBeNull();
    expect(parsePanelParam("ocena", ["zalaczniki"])).toBeNull();
  });
});

describe("parseChatParam", () => {
  it("1 i 0 są jawne, wszystko inne to brak decyzji (domyślne ustawienie wg szerokości)", () => {
    expect(parseChatParam("1")).toBe(true);
    expect(parseChatParam("0")).toBe(false);
    expect(parseChatParam(undefined)).toBeNull();
    expect(parseChatParam("tak")).toBeNull();
    expect(parseChatParam(["1"])).toBeNull();
  });
});

describe("withUiParams", () => {
  it("zachowuje inne parametry (wariant) i ustawia lub usuwa panel i czat", () => {
    expect(withUiParams("?wariant=v1", { panel: "ocena" })).toBe("?wariant=v1&panel=ocena");
    expect(withUiParams("?wariant=v1&panel=ocena", { panel: null })).toBe("?wariant=v1");
    expect(withUiParams("", { panel: "eksport", chat: false })).toBe("?panel=eksport&czat=0");
    expect(withUiParams("?czat=0", { chat: null })).toBe("");
    expect(withUiParams("?czat=0&panel=ocena", { chat: true })).toBe("?czat=1&panel=ocena");
  });

  it("nie dotyka parametru, którego nie ma w zmianie", () => {
    expect(withUiParams("?panel=ocena&czat=1", {})).toBe("?panel=ocena&czat=1");
  });
});

describe("pendingProposalsText", () => {
  it("odmienia po polsku", () => {
    expect(pendingProposalsText(1)).toBe("1 propozycja oczekuje na decyzję");
    expect(pendingProposalsText(2)).toBe("2 propozycje oczekują na decyzję");
    expect(pendingProposalsText(5)).toBe("5 propozycji oczekuje na decyzję");
    expect(pendingProposalsText(12)).toBe("12 propozycji oczekuje na decyzję");
    expect(pendingProposalsText(22)).toBe("22 propozycje oczekują na decyzję");
  });
});

const baseInput: ToolbarBadgeInput = {
  pendingProposals: 0,
  currentVersion: 7,
  evaluation: { hasAny: true, latestVersion: 7 },
  impactActive: false,
  variantCount: 3,
  refinement: { rounds: 0, awaitingAnswers: false, max: 3 },
  attachments: { count: 3, max: 10 },
  dirty: false,
};

describe("toolbarBadges", () => {
  it("stan spokojny: tylko liczniki wariantów i załączników", () => {
    const badges = toolbarBadges(baseInput);

    expect(badges.czat).toBeNull();
    expect(badges.ocena).toBeNull();
    expect(badges.wplyw).toBeNull();
    expect(badges.eksport).toBeNull();
    expect(badges.poprawki).toBeNull();
    expect(badges.porownanie).toBeNull();
    expect(badges.warianty).toMatchObject({ text: "3" });
    expect(badges.zalaczniki).toMatchObject({ text: "3/10", description: "3 z 10 załączników" });
  });

  it("czat: liczba oczekujących propozycji z opisem po polsku", () => {
    expect(toolbarBadges({ ...baseInput, pendingProposals: 2 }).czat).toEqual({ text: "2", description: "2 propozycje oczekują na decyzję" });
  });

  it("ocena: „nieaktualna” gdy ocena dotyczy starszej wersji, „brak” gdy nie ma oceny, nic gdy aktualna", () => {
    expect(toolbarBadges({ ...baseInput, evaluation: { hasAny: true, latestVersion: 5 } }).ocena).toMatchObject({
      text: "nieaktualna",
      description: "ocena nieaktualna: dotyczy wersji 5, bieżąca wersja to 7",
    });
    expect(toolbarBadges({ ...baseInput, evaluation: { hasAny: false, latestVersion: null } }).ocena).toMatchObject({ text: "brak" });
    expect(toolbarBadges({ ...baseInput, evaluation: { hasAny: true, latestVersion: 7 } }).ocena).toBeNull();
  });

  it("plakietka „nieaktualna” pojawia się po zapisie (bieżąca wersja rośnie), bez odświeżenia danych oceny", () => {
    expect(toolbarBadges({ ...baseInput, currentVersion: 8 }).ocena).toMatchObject({ text: "nieaktualna" });
  });

  it("wpływ, cykl poprawek i eksport", () => {
    const badges = toolbarBadges({
      ...baseInput,
      impactActive: true,
      refinement: { rounds: 1, awaitingAnswers: true, max: 3 },
      dirty: true,
    });

    expect(badges.wplyw).toMatchObject({ text: "aktywna" });
    expect(badges.poprawki).toEqual({ text: "1/3", description: "runda 1 z 3, czeka na odpowiedzi" });
    expect(badges.eksport).toMatchObject({ text: "niezapisane", description: "niezapisane zmiany nie są uwzględnione w eksporcie" });
  });

  it("każda plakietka ma krótki widoczny tekst i dłuższy opis (czytnik nie czyta skrótu)", () => {
    const badges = toolbarBadges({
      ...baseInput,
      pendingProposals: 3,
      impactActive: true,
      dirty: true,
      refinement: { rounds: 2, awaitingAnswers: false, max: 3 },
      evaluation: { hasAny: true, latestVersion: 1 },
    });

    for (const badge of Object.values(badges)) {
      if (badge) {
        expect(badge.text.length).toBeLessThanOrEqual(12);
        expect(badge.description.length).toBeGreaterThanOrEqual(badge.text.length);
      }
    }
  });
});

describe("nextToolbarIndex (roving tabindex)", () => {
  it("strzałki przechodzą cyklicznie, Home i End skaczą na początek i koniec", () => {
    expect(nextToolbarIndex(0, "ArrowRight", 8)).toBe(1);
    expect(nextToolbarIndex(7, "ArrowRight", 8)).toBe(0);
    expect(nextToolbarIndex(0, "ArrowLeft", 8)).toBe(7);
    expect(nextToolbarIndex(3, "ArrowLeft", 8)).toBe(2);
    expect(nextToolbarIndex(3, "Home", 8)).toBe(0);
    expect(nextToolbarIndex(3, "End", 8)).toBe(7);
  });

  it("inne klawisze i pusty pasek: brak przejścia (Tab opuszcza pasek, Enter i Spacja obsługuje przycisk)", () => {
    expect(nextToolbarIndex(0, "Tab", 8)).toBeNull();
    expect(nextToolbarIndex(0, "Enter", 8)).toBeNull();
    expect(nextToolbarIndex(0, " ", 8)).toBeNull();
    expect(nextToolbarIndex(0, "ArrowRight", 0)).toBeNull();
  });
});

describe("etykiety", () => {
  it("każdy przycisk paska i panel ma etykietę, a kolejność zaczyna się od czatu", () => {
    expect(TOOLBAR_ORDER[0]).toBe("czat");
    for (const id of TOOLBAR_ORDER) {
      expect(TOOLBAR_LABELS[id]).toBeTruthy();
    }
    for (const id of PANEL_IDS) {
      expect(PANEL_TITLES[id]).toBeTruthy();
    }
    expect(TOOLBAR_ORDER.map((id) => TOOLBAR_LABELS[id])).toEqual([
      "Czat",
      "Ocena",
      "Wpływ",
      "Warianty i strategie",
      "Porównanie",
      "Cykl poprawek",
      "Załączniki",
      "Eksport i raport",
    ]);
  });
});
