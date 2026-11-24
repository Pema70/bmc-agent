"use client";

import Link from "next/link";
import { useCallback, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { useOptionalVariantWorkspace } from "@/components/bmc/variant-workspace";
import { useOptionalImpact } from "@/components/impact/impact-provider";
import { PanelControlContext } from "@/components/project/panel-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, PanelHeader } from "@/components/ui/card";
import { StateChip } from "@/components/ui/state-chip";
import {
  PANEL_IDS,
  PANEL_TITLES,
  TOOLBAR_LABELS,
  nextToolbarIndex,
  toolbarBadges,
  withUiParams,
  type PanelId,
  type ToolbarBadgeInput,
  type ToolbarItemId,
} from "@/lib/ui/panels";

export type ProjectShellProps = {
  /** Tytuł projektu, opis i rola (serwerowo). */
  header: ReactNode;
  /** Bieżący wariant (nazwa i znaczniki) albo null, gdy projekt nie ma wariantu. */
  variant: { name: string; isMain: boolean; fromStrategy: boolean; version: number } | null;
  canvas: ReactNode;
  /** „chat” = czat agenta, „notice” = komunikat zamiast czatu (wariant niegłówny), „none” = brak sekcji czatu. */
  chatKind: "chat" | "notice" | "none";
  chat: ReactNode;
  /** Zawartość paneli; klucz = dozwolony panel. Wszystkie są zamontowane przez cały czas (nieaktywne mają `hidden`). */
  panels: Partial<Record<PanelId, ReactNode>>;
  initialPanel: PanelId | null;
  /** Jawne ustawienie z adresu (`?czat=`) albo null: wtedy czat jest rozwinięty od szerokości `lg`. */
  initialChatOpen: boolean | null;
  badgeData: Pick<ToolbarBadgeInput, "evaluation" | "variantCount" | "refinement" | "attachments">;
  footer: ReactNode;
};

const WIDE_QUERY = "(min-width: 64rem)";

function subscribeWide(onChange: () => void): () => void {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const isWide = (): boolean => window.matchMedia(WIDE_QUERY).matches;
// Po stronie serwera i podczas hydracji zakładamy szeroki ekran (czat rozwinięty), potem React poprawia na bieżący.
const isWideOnServer = (): boolean => true;

/**
 * Zapis `?panel=` i `?czat=` w adresie bez żądania do serwera i bez przemontowania (replaceState; inne parametry zostają).
 * Używa natywnej metody z prototypu, a nie `window.history.replaceState` podmienionego przez Next: ta wersja wysyła akcję
 * do routera Next, co przy trwającym odświeżeniu danych serwera (po zapisie, akceptacji) kończyło się w konsoli błędem Reacta
 * „called use() to suspend in a previous render but did not call use()”. Stan historii (`history.state`) zostaje bez zmian.
 */
function syncUrl(update: { panel?: PanelId | null; chat?: boolean | null }): void {
  try {
    const url = `${window.location.pathname}${withUiParams(window.location.search, update)}${window.location.hash}`;
    History.prototype.replaceState.call(window.history, window.history.state, "", url);
  } catch {
    // Adres nie jest niezbędny do działania (np. przeglądarka blokuje History API): panel działa dalej.
  }
}

/**
 * Powłoka strony projektu: przyklejony pasek narzędzi (nad tytułem), tytuł, płótno na całą szerokość, zwijany czat pod płótnem
 * i jeden otwarty panel pod czatem. Wszystkie panele i czat są ZAMONTOWANE przez cały czas (nieaktywne mają `hidden`), więc
 * przełączanie ani zwijanie nie przemontowuje płótna, czatu ani paneli: niezapisane zmiany, rozmowa, szkice i trwające akcje
 * zostają. Elementy (`canvas`, `chat`, `panels`) przychodzą jako gotowe `ReactNode` z serwera i mają stałe miejsce w drzewie.
 */
export function ProjectShell({
  header,
  variant,
  canvas,
  chatKind,
  chat,
  panels,
  initialPanel,
  initialChatOpen,
  badgeData,
  footer,
}: ProjectShellProps) {
  const workspace = useOptionalVariantWorkspace();
  const impact = useOptionalImpact();
  const [panel, setPanel] = useState<PanelId | null>(initialPanel);
  const [chatChoice, setChatChoice] = useState<boolean | null>(initialChatOpen);
  const wide = useSyncExternalStore(subscribeWide, isWide, isWideOnServer);
  const chatOpen = chatChoice ?? wide;
  const buttonRefs = useRef<Partial<Record<ToolbarItemId, HTMLButtonElement | null>>>({});
  const headingRefs = useRef<Partial<Record<PanelId, HTMLHeadingElement | null>>>({});
  const [focusIndex, setFocusIndex] = useState(0);

  const available = PANEL_IDS.filter((id) => panels[id] !== undefined);
  const items: ToolbarItemId[] = [...(chatKind === "none" ? [] : (["czat"] as const)), ...available];

  const pending = workspace ? Object.values(workspace.proposals).filter((item) => item.status === "PENDING").length : 0;
  const currentVersion = workspace?.version ?? variant?.version ?? 0;
  const badges = toolbarBadges({
    ...badgeData,
    pendingProposals: pending,
    currentVersion,
    impactActive: impact?.active != null,
    dirty: workspace?.dirty ?? false,
  });

  const openPanel = useCallback((id: PanelId | null, fromUser: boolean) => {
    setPanel(id);
    syncUrl({ panel: id });
    if (id && fromUser) {
      // Po otwarciu z paska: fokus na nagłówek panelu i przewinięcie do widoku (nie po wczytaniu z adresu).
      window.requestAnimationFrame(() => {
        const heading = headingRefs.current[id];
        heading?.focus({ preventScroll: true });
        heading?.scrollIntoView({ block: "nearest" });
      });
    }
  }, []);

  function toggleChat() {
    const next = !chatOpen;
    setChatChoice(next);
    syncUrl({ chat: next });
  }

  function activate(id: ToolbarItemId) {
    if (id === "czat") {
      toggleChat();
      return;
    }
    openPanel(panel === id ? null : id, true);
  }

  function onToolbarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((id) => buttonRefs.current[id] === document.activeElement);
    if (index < 0) {
      return;
    }
    const target = nextToolbarIndex(index, event.key, items.length);
    if (target === null) {
      return;
    }
    event.preventDefault();
    setFocusIndex(target);
    const button = buttonRefs.current[items[target]];
    button?.focus();
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function onPanelKeyDown(event: KeyboardEvent<HTMLElement>, id: PanelId) {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.stopPropagation();
      openPanel(null, false);
      buttonRefs.current[id]?.focus();
    }
  }

  return (
    <PanelControlContext.Provider value={{ open: (id) => openPanel(id, true) }}>
      <nav
        aria-label="Menu projektu"
        className="bg-glassy sticky top-0 z-40 border-b shadow-lg shadow-black/30"
      >
        <div className="mx-auto flex w-full max-w-[120rem] items-center gap-3 px-3 py-2 sm:px-6 lg:px-8">
          <Link href="/projekty" className="shrink-0 text-sm font-bold whitespace-nowrap text-muted hover:text-text">
            ← Projekty
          </Link>
          <div
            role="toolbar"
            aria-label="Narzędzia modelu"
            onKeyDown={onToolbarKeyDown}
            className="flex min-w-0 flex-1 flex-nowrap gap-2 overflow-x-auto py-1 pr-6 [mask-image:linear-gradient(to_right,#000_calc(100%_-_28px),transparent)] [scrollbar-width:thin]"
          >
            {items.map((id, index) => {
              const active = id === "czat" ? chatOpen : panel === id;
              const badge = badges[id];
              const controls = id === "czat" ? "chat-body" : `panel-${id}`;
              return (
                <button
                  key={id}
                  id={`tb-${id}`}
                  ref={(node) => {
                    buttonRefs.current[id] = node;
                  }}
                  type="button"
                  aria-expanded={active}
                  aria-controls={controls}
                  tabIndex={index === focusIndex ? 0 : -1}
                  onFocus={() => setFocusIndex(index)}
                  onClick={() => activate(id)}
                  className={`inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-1 text-sm whitespace-nowrap transition-shadow motion-reduce:transition-none ${
                    active
                      ? "bg-accent-grad border-transparent font-bold"
                      : "border-border bg-tint text-text hover:border-primary-from hover:shadow-[0_0_0_3px_rgba(125,178,255,0.16)]"
                  }`}
                >
                  {TOOLBAR_LABELS[id]}
                  {badge ? (
                    <span className={active ? "[&>span]:border-transparent [&>span]:bg-on-accent [&>span]:text-accent-from" : "[&>span]:border-transparent [&>span]:bg-accent-from [&>span]:text-on-accent"}>
                      <Badge text={badge.text} description={badge.description} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      <main className="mx-auto flex w-full max-w-[120rem] flex-1 flex-col gap-7 px-4 py-8 sm:px-6 lg:px-8">
        {header}

        {variant ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 font-display text-xl font-bold break-words">{variant.name}</span>
            {variant.isMain ? <StateChip tone="main" label="Główny" /> : null}
            {variant.fromStrategy ? <StateChip tone="ai" label="Strategia AI" /> : null}
            <span className="text-sm text-muted">
              wersja {currentVersion} · {workspace?.dirty ? "są niezapisane zmiany" : "zapisany stan"}
            </span>
            {available.includes("warianty") ? (
              <Button variant="secondary" size="sm" onClick={() => openPanel("warianty", true)}>
                Zmień wariant
              </Button>
            ) : null}
          </div>
        ) : null}

        <div id="canvas-region" aria-label="Płótno modelu biznesowego">
          {canvas}
        </div>

        {chatKind !== "none" ? (
          <Card className="shadow-lg shadow-black/30">
            <PanelHeader id="chat-shell-title" title="Czat z agentem">
              <Button
                variant="secondary"
                size="sm"
                aria-expanded={chatOpen}
                aria-controls="chat-body"
                onClick={toggleChat}
              >
                {chatOpen ? "Zwiń czat" : "Rozwiń czat"}
              </Button>
            </PanelHeader>
            <div id="chat-body" hidden={!chatOpen}>
              {chat}
            </div>
          </Card>
        ) : null}

        <div id="panel-region" className="flex scroll-mt-20 flex-col">
          {available.map((id) => (
            <section
              key={id}
              id={`panel-${id}`}
              aria-labelledby={`panel-title-${id}`}
              hidden={panel !== id}
              onKeyDown={(event) => onPanelKeyDown(event, id)}
              className="overflow-hidden rounded-2xl border bg-surface text-text shadow-lg shadow-black/30"
            >
              <PanelHeader
                id={`panel-title-${id}`}
                title={PANEL_TITLES[id]}
                headingRef={(node) => {
                  headingRefs.current[id] = node;
                }}
              >
                <Button variant="secondary" size="sm" onClick={() => openPanel(null, false)}>
                  Zamknij
                </Button>
              </PanelHeader>
              <div className="flex flex-col gap-4 p-5">{panels[id]}</div>
            </section>
          ))}
        </div>

        {footer}
      </main>
    </PanelControlContext.Provider>
  );
}
