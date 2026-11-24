import type { ReactNode } from "react";

/** Powierzchnia na treść: jednolite tło (tekst zawsze na jednolitym tle, WCAG AA), ramka i zaokrąglenie. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-border bg-surface text-text ${className ?? ""}`.trimEnd()}>{children}</div>
  );
}

/** Nagłówek panelu i bloku: gradient (30%) z białym tekstem o kontraście sprawdzonym na obu końcach gradientu. */
export function PanelHeader({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <header className="bg-head flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
      <h2 id={id} className="text-lg font-bold">
        {title}
      </h2>
      {children}
    </header>
  );
}
