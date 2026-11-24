"use client";

import { createContext, useContext } from "react";
import type { PanelId } from "@/lib/ui/panels";

type PanelControl = { open: (id: PanelId) => void };

export const PanelControlContext = createContext<PanelControl | null>(null);

/** Otwiera panel z paska narzędzi (np. odnośnik „Przejdź do oceny modelu” w cyklu poprawek). Poza powłoką nic nie robi. */
export function useOpenPanel(): (id: PanelId) => void {
  const control = useContext(PanelControlContext);
  return (id) => control?.open(id);
}
