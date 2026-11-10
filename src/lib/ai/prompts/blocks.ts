import type { BlockKey } from "@/lib/schemas/bmc";

// Krótkie wytyczne dla każdego bloku: czym jest, o co pytać, typowe błędy.
export const BLOCK_GUIDELINES: Record<BlockKey, string> = {
  customer_segments:
    "Grupy klientów, dla których tworzymy wartość. Pytaj, kto dokładnie płaci i kto korzysta, jak segmenty różnią się potrzebami. Typowy błąd: segment „wszyscy”.",
  value_propositions:
    "Problem klienta i sposób, w jaki go rozwiązujemy. Pytaj, jaką potrzebę zaspokaja produkt i czym wyróżnia się na tle alternatyw. Typowy błąd: lista funkcji zamiast korzyści.",
  channels:
    "Sposoby docierania do klientów i dostarczania im oferty. Pytaj, jak klient dowiaduje się o ofercie, kupuje i dostaje produkt. Typowy błąd: brak kanału sprzedaży lub obsługi po zakupie.",
  customer_relationships:
    "Rodzaj relacji z każdym segmentem (samoobsługa, opiekun, społeczność). Pytaj, jak pozyskujemy i utrzymujemy klientów. Typowy błąd: ta sama relacja dla wszystkich segmentów.",
  revenue_streams:
    "Za co i jak klienci płacą (sprzedaż, subskrypcja, prowizja). Pytaj, ile klient jest gotów zapłacić i jak. Typowy błąd: przychody bez związku z propozycją wartości.",
  key_resources:
    "Zasoby niezbędne do działania (ludzie, technologia, kapitał, marka). Pytaj, bez czego oferta nie mogłaby powstać. Typowy błąd: wymienianie wszystkiego, nie tylko kluczowych zasobów.",
  key_activities:
    "Najważniejsze działania potrzebne do dostarczenia oferty. Pytaj, co firma musi robić codziennie. Typowy błąd: opisywanie zasobów zamiast działań.",
  key_partnerships:
    "Partnerzy i dostawcy, bez których model nie zadziała. Pytaj, które zasoby lub działania lepiej kupić lub dzielić z partnerem. Typowy błąd: lista kontaktów bez uzasadnienia roli.",
  cost_structure:
    "Najważniejsze koszty modelu. Pytaj, co generuje największe koszty i czy wynikają z kluczowych zasobów i działań. Typowy błąd: pominięcie kosztów stałych lub kosztów pozyskania klienta.",
};
