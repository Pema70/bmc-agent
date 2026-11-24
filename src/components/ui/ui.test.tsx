import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, PanelHeader } from "@/components/ui/card";
import { StateChip, type StateTone } from "@/components/ui/state-chip";

describe("StateChip", () => {
  const tones: StateTone[] = ["ai", "low", "medium", "high", "main"];

  it("każdy stan ma etykietę tekstową (nie tylko kolor) i klasy własnego tonu", () => {
    for (const tone of tones) {
      const markup = renderToStaticMarkup(<StateChip tone={tone} label={`Etykieta ${tone}`} />);

      expect(markup, tone).toContain(`Etykieta ${tone}`);
      expect(markup, tone).toContain(`bg-${tone}-bg`);
      expect(markup, tone).toContain(`text-${tone}-fg`);
      expect(markup, tone).toContain(`border-${tone}-border`);
    }
  });

  it("etykieta jest zwykłym tekstem (znaczniki są zamienione na encje)", () => {
    const markup = renderToStaticMarkup(<StateChip tone="ai" label={"<b>x</b>"} />);

    expect(markup).not.toContain("<b>");
    expect(markup).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("Badge", () => {
  it("bez opisu pokazuje tylko tekst", () => {
    const markup = renderToStaticMarkup(<Badge text="3/10" />);

    expect(markup).toContain("3/10");
    expect(markup).not.toContain("sr-only");
  });

  it("z opisem: widoczny tekst jest ukryty dla czytników, a pełny opis jest tylko dla nich", () => {
    const markup = renderToStaticMarkup(<Badge text="2" description="2 oczekujące propozycje" />);

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('<span class="sr-only">2 oczekujące propozycje</span>');
  });
});

describe("Button i buttonClass", () => {
  it("przycisk główny ma gradient akcentu, drugorzędny jednolitą powierzchnię", () => {
    expect(buttonClass("primary")).toContain("bg-cta");
    expect(buttonClass("secondary")).toContain("bg-surface");
    expect(buttonClass("secondary")).not.toContain("bg-cta");
  });

  it("domyślnie type=button (nie wysyła formularza), disabled i dodatkowe klasy działają", () => {
    const markup = renderToStaticMarkup(
      <Button disabled className="w-full">
        Zapisz
      </Button>,
    );

    expect(markup).toContain('type="button"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("w-full");
    expect(markup).toContain("Zapisz");
  });
});

describe("Card i PanelHeader", () => {
  it("karta leży na jednolitej powierzchni; nagłówek panelu ma gradient i nagłówek h2 z identyfikatorem", () => {
    const card = renderToStaticMarkup(<Card>Treść</Card>);
    const header = renderToStaticMarkup(<PanelHeader id="ocena-heading" title="Ocena modelu" />);

    expect(card).toContain("bg-surface");
    expect(card).not.toContain("bg-head");
    expect(header).toContain("bg-head");
    expect(header).toContain('<h2 id="ocena-heading"');
    expect(header).toContain("Ocena modelu");
  });
});
