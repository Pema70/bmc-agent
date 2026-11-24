import type { ReactNode } from "react";

/** Powierzchnia na treść: jednolite tło (tekst zawsze na jednolitym tle, WCAG AA), ramka i zaokrąglenie. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-border bg-surface text-text ${className ?? ""}`.trimEnd()}>{children}</div>
  );
}

/** Nagłówek panelu i bloku: gradient (30%) z białym tekstem o kontraście sprawdzonym na obu końcach gradientu. */
export function PanelHeader({
  id,
  title,
  children,
  headingRef,
}: {
  id: string;
  title: string;
  children?: ReactNode;
  /** Gdy podany, nagłówek można sfokusować programowo (np. po otwarciu panelu z paska). */
  headingRef?: (node: HTMLHeadingElement | null) => void;
}) {
  return (
    <header className="bg-head flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
      <h2 id={id} ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="text-lg font-bold outline-none">
        {title}
      </h2>
      {children}
    </header>
  );
}
