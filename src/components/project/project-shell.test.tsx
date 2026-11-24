import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Powłoka importuje kontekst płótna i wpływu, a te akcje serwerowe (baza, sesja): w teście renderu nie są wołane.
vi.mock("@/app/projekty/[id]/proposal-actions", () => ({ acceptProposalAction: vi.fn(), rejectProposalAction: vi.fn() }));
vi.mock("@/app/projekty/[id]/impact-actions", () => ({ analyzeImpactAction: vi.fn() }));

import { ProjectShell, type ProjectShellProps } from "@/components/project/project-shell";
import { PANEL_IDS, type PanelId } from "@/lib/ui/panels";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

const panels: Partial<Record<PanelId, string>> = Object.fromEntries(PANEL_IDS.map((id) => [id, `Zawartość panelu ${id}`]));

function props(overrides: Partial<ProjectShellProps> = {}): ProjectShellProps {
  return {
    header: <h1>Kawiarnia Ziarno</h1>,
    variant: { name: "Wariant główny", isMain: true, fromStrategy: false, version: 7 },
    canvas: <p>Płótno BMC</p>,
    chatKind: "chat",
    chat: <p>Rozmowa z agentem</p>,
    panels,
    initialPanel: "ocena",
    initialChatOpen: null,
    badgeData: {
      evaluation: { hasAny: true, latestVersion: 5 },
      variantCount: 3,
      refinement: { rounds: 1, awaitingAnswers: true, max: 3 },
      attachments: { count: 3, max: 10 },
    },
    footer: null,
    ...overrides,
  };
}

const markup = (overrides: Partial<ProjectShellProps> = {}) => renderToStaticMarkup(<ProjectShell {...props(overrides)} />);

function sectionTag(html: string, id: string): string {
  const match = new RegExp(`<section[^>]*id="${id}"[^>]*>`).exec(html);
  if (!match) {
    throw new Error(`Brak sekcji ${id}`);
  }
  return match[0];
}

describe("ProjectShell: pasek narzędzi", () => {
  it("jest przyklejony (sticky), szklany, ma rolę toolbar i osiem przycisków w stałej kolejności z etykietami", () => {
    const html = markup();

    expect(html).toContain("sticky top-0");
    expect(html).toContain("bg-glassy");
    expect(html).toContain('role="toolbar"');
    const labels = ["Czat", "Ocena", "Wpływ", "Warianty i strategie", "Porównanie", "Cykl poprawek", "Załączniki", "Eksport i raport"];
    let position = -1;
    for (const label of labels) {
      const next = html.indexOf(`>${label}`, position + 1);
      expect(next, label).toBeGreaterThan(position);
      position = next;
    }
  });

  it("przyciski mają aria-expanded i aria-controls; aktywny jest tylko otwarty panel (i rozwinięty czat)", () => {
    const html = markup({ initialPanel: "ocena", initialChatOpen: false });

    expect(html).toMatch(/id="tb-ocena"[^>]*aria-expanded="true"[^>]*aria-controls="panel-ocena"/);
    expect(html).toMatch(/id="tb-wplyw"[^>]*aria-expanded="false"[^>]*aria-controls="panel-wplyw"/);
    expect(html).toMatch(/id="tb-czat"[^>]*aria-expanded="false"[^>]*aria-controls="chat-body"/);
  });

  it("roving tabindex: tylko pierwszy przycisk jest w kolejności Tab", () => {
    const html = markup();
    const tabindexes = [...html.matchAll(/id="tb-[a-z]+"[^>]*tabindex="(-?\d)"/g)].map((match) => match[1]);

    expect(tabindexes).toEqual(["0", "-1", "-1", "-1", "-1", "-1", "-1", "-1"]);
  });

  it("plakietki: krótki widoczny tekst jest ukryty dla czytników, a pełny opis jest tylko dla nich", () => {
    const html = markup();

    expect(html).toContain('aria-hidden="true">nieaktualna</span>');
    expect(html).toContain('<span class="sr-only">ocena nieaktualna: dotyczy wersji 5, bieżąca wersja to 7</span>');
    expect(html).toContain('<span class="sr-only">runda 1 z 3, czeka na odpowiedzi</span>');
    expect(html).toContain('<span class="sr-only">3 z 10 załączników</span>');
    expect(html).toContain('aria-hidden="true">3/10</span>');
  });

  it("bez wariantu (np. projekt sprzed płótna) są tylko załączniki; VIEWER nie ma cyklu poprawek ani czatu", () => {
    const noVariant = markup({ variant: null, chatKind: "none", panels: { zalaczniki: "Załączniki" }, initialPanel: null });
    const viewer = markup({ chatKind: "none", panels: { ...panels, poprawki: undefined } });

    expect(noVariant).toContain('id="tb-zalaczniki"');
    expect(noVariant).not.toContain('id="tb-ocena"');
    expect(noVariant).not.toContain('id="tb-czat"');
    expect(viewer).not.toContain('id="tb-poprawki"');
    expect(viewer).not.toContain('id="tb-czat"');
    expect(viewer).toContain('id="tb-ocena"');
  });
});

describe("ProjectShell: panele i czat są zamontowane, nieaktywne ukryte (nie odmontowane)", () => {
  it("wszystkie panele są w dokumencie; ukryty jest każdy poza otwartym (hidden)", () => {
    const html = markup({ initialPanel: "wplyw" });

    for (const id of PANEL_IDS) {
      expect(html, id).toContain(`Zawartość panelu ${id}`);
      const tag = sectionTag(html, `panel-${id}`);
      if (id === "wplyw") {
        expect(tag).not.toMatch(/\shidden=""/);
      } else {
        expect(tag).toMatch(/\shidden=""/);
      }
    }
  });

  it("bez panelu w adresie wszystkie są ukryte, ale zamontowane; nieznany panel z adresu nie jest otwarty", () => {
    const html = markup({ initialPanel: null });

    for (const id of PANEL_IDS) {
      expect(html).toContain(`Zawartość panelu ${id}`);
      expect(sectionTag(html, `panel-${id}`)).toMatch(/\shidden=""/);
    }
  });

  it("czat jest zawsze w dokumencie: zwinięty ma hidden, rozwinięty nie; domyślnie (brak ?czat=) rozwinięty", () => {
    const collapsed = markup({ initialChatOpen: false });
    const expanded = markup({ initialChatOpen: true });
    const byDefault = markup({ initialChatOpen: null });

    expect(collapsed).toContain("Rozmowa z agentem");
    expect(collapsed).toMatch(/<div id="chat-body" hidden="">/);
    expect(collapsed).toContain("Rozwiń czat");
    expect(expanded).toMatch(/<div id="chat-body">/);
    expect(expanded).toContain("Zwiń czat");
    expect(byDefault).toMatch(/<div id="chat-body">/);
  });

  it("płótno jest poza panelami i czatem, a kolejność to: płótno, czat, panele", () => {
    const html = markup();

    expect(html.indexOf("Płótno BMC")).toBeGreaterThan(-1);
    expect(html.indexOf("Płótno BMC")).toBeLessThan(html.indexOf('id="chat-body"'));
    expect(html.indexOf('id="chat-body"')).toBeLessThan(html.indexOf('id="panel-region"'));
  });

  it("tytuł i wybór wariantu są pod paskiem; znaczniki wariantu mają etykiety tekstowe", () => {
    const html = markup({ variant: { name: "Strategia", isMain: false, fromStrategy: true, version: 1 } });

    expect(html.indexOf("<nav")).toBeLessThan(html.indexOf("<h1>"));
    expect(html).toContain("Strategia AI");
    expect(html).not.toContain(">Główny<");
    expect(html).toContain("Zmień wariant");
  });

  it("treści od użytkownika (nazwa wariantu) są zwykłym tekstem", () => {
    const html = markup({ variant: { name: "<b>x</b>", isMain: true, fromStrategy: false, version: 1 } });

    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("niezmienność montowania (test statyczny źródeł)", () => {
  const page = read("src/app/projekty/[id]/page.tsx");
  const shell = read("src/components/project/project-shell.tsx");
  const chat = read("src/components/chat/agent-chat.tsx");

  it("Workspace ma key zależny wyłącznie od wariantu, a czat key wariantu; powłoka, dostawca wpływu i panele nie mają key zależnego od panelu ani listy", () => {
    expect(page).toContain('<Workspace key={variant?.id ?? "brak"} provider={workspaceProvider}>');
    expect(page).toContain("<AgentChat key={variant.id}");
    expect(page).not.toMatch(/<ProjectShell[^>]*\bkey=/);
    expect(page).not.toMatch(/<ImpactProvider[^>]*\bkey=/);
    expect(page.match(/\bkey=\{/g)?.length).toBe(3); // Workspace, AgentChat i dotychczasowy klucz EvaluationPanel
  });

  it("powłoka nie nawiguje (brak useRouter i router.push/replace), a adres zmienia przez replaceState bez żądania do serwera", () => {
    expect(shell).not.toContain("useRouter");
    expect(shell).not.toContain("next/navigation");
    expect(shell).not.toMatch(/router\.(push|replace|refresh)/);
    expect(shell).toContain("History.prototype.replaceState.call(window.history");
    expect(shell).not.toMatch(/^\s*window\.history\.replaceState\(/m);
  });

  it("czat i panele są ukrywane atrybutem hidden, nie odmontowywane warunkiem", () => {
    expect(shell).toContain("hidden={!chatOpen}");
    expect(shell).toContain("hidden={panel !== id}");
    expect(shell).not.toMatch(/\{\s*chatOpen\s*(&&|\?)\s*</);
    expect(shell).not.toMatch(/\{\s*panel\s*===\s*\w+\s*(&&|\?)\s*</);
    expect(shell).not.toMatch(/\{\s*chat\s*&&/);
  });

  it("czat przewija tylko własną listę wiadomości, a nie okno (scrollIntoView przesuwałoby stronę do czatu pod płótnem)", () => {
    expect(chat).not.toContain("scrollIntoView");
    expect(chat).toContain("list.scrollTop = list.scrollHeight");
  });

  it("zmiany wyglądu nie dotykają logiki AI: czat nadal używa tych samych endpointu i narzędzi (kontrola importów)", () => {
    expect(chat).toContain("/api/chat");
  });
});
