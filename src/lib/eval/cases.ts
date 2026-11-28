import { createHash } from "node:crypto";
import { z } from "zod";
import { SEED_COMPANIES } from "@/lib/seed/companies";

// Zestaw przypadków ewaluacji (krok 10, PR 10f, plan: punkt 22). ZAMROŻONY przed pierwszą serią pomiarów: zmiana
// czegokolwiek tutaj (albo stanu firm użytych w `EVAL` i fixture'ach `CHAT` w `companies.ts`) zmienia sumę kontrolną
// i wymaga świadomej decyzji właściciela oraz nowej serii. Treść pochodzi wyłącznie z publicznych opisów w seedzie
// (`companies.ts`) i ze scenariuszy z `docs/plan-pr-p.md`; nie ma tu nic z rozmów ani danych osobowych.

export const SeedKey = z.enum(["netflix", "airbnb", "spotify", "blockbuster", "quibi", "juicero", "kawiarnia-ziarno"]);
export type SeedKey = z.infer<typeof SeedKey>;

/** Ostatnia wiadomość skryptu każdego przypadku BUILD (jak ostatnia wiadomość S1 w PR „P”). */
export const BUILD_FINAL_MESSAGE = "Zaproponuj wpisy do wszystkich bloków na podstawie tego, co napisałem.";

export const BuildCase = z.strictObject({
  id: z.string().regex(/^BUILD-0[1-7]$/),
  kind: z.literal("BUILD"),
  /** Klucz firmy w `SEED_COMPANIES`; używany tylko do sprawdzeń, nie trafia do promptu. */
  companyKey: SeedKey,
  /** Prawdziwa nazwa: wyłącznie klucz wyników, nigdy w nazwie projektu, opisie, wiadomościach ani eksporcie do oceny ręcznej. */
  trueName: z.string().min(1),
  /** Dodatkowe nazwy własne zdradzające firmę (produkty, założyciele, marki); do listy zakazanych tokenów. */
  aliases: z.array(z.string().min(1)),
  outcome: z.enum(["SUCCESS", "FAILURE", "FICTIONAL"]),
  /** Zanonimizowany opis wejściowy (jest też częścią pierwszej wiadomości). */
  description: z.string().min(1),
  /** Stały skrypt wiadomości użytkownika, niezależny od pytań agenta (jak S1 w PR „P”). */
  messages: z.array(z.string().min(1)).length(6),
});
export type BuildCase = z.infer<typeof BuildCase>;

export const EvalCase = z.strictObject({
  id: z.string().regex(/^EVAL-0[1-7]$/),
  kind: z.literal("EVAL"),
  /** Gotowy model z seeda (z nazwami: to ocena gotowego modelu, nie budowa z opisu). */
  companyKey: SeedKey,
});
export type EvalCase = z.infer<typeof EvalCase>;

export const ChatTurn = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("message"), text: z.string().min(1) }),
  // Akcja „Analizuj wpływ” na propozycji z poprzedniej tury (S4); w skrypcie `runImpactAnalysis` wprost.
  z.strictObject({ type: z.literal("impact") }),
]);
export type ChatTurn = z.infer<typeof ChatTurn>;

export const ChatCase = z.strictObject({
  id: z.string().regex(/^CHAT-S[1-5]$/),
  kind: z.literal("CHAT"),
  /** Stan początkowy: pusty model albo wypełniony stan firmy z seeda (fikcyjna Kawiarnia Ziarno). */
  fixture: z.union([z.literal("EMPTY"), SeedKey]),
  /** Przypadek kontynuujący rozmowę w projekcie innego przypadku (S5 po S3). */
  sameProjectAs: z.string().optional(),
  turns: z.array(ChatTurn).min(1),
});
export type ChatCase = z.infer<typeof ChatCase>;

export type EvalCaseDefinition = BuildCase | EvalCase | ChatCase;

const RAW_BUILD_CASES: BuildCase[] = [
  {
    id: "BUILD-01",
    kind: "BUILD",
    companyKey: "kawiarnia-ziarno",
    trueName: "Kawiarnia Ziarno",
    aliases: [],
    outcome: "FICTIONAL",
    description: "Kawiarnia w centrum dużego miasta, kawa speciality i proste śniadania.",
    messages: [
      "Chcę otworzyć kawiarnię. Pomóż mi zbudować model biznesowy. Kawiarnia w centrum dużego miasta, kawa speciality i proste śniadania.",
      "Klienci to głównie studenci okolicznych uczelni i pracownicy biur z centrum.",
      "Wyróżniamy się świeżo paloną kawą speciality w cenie sieciówki i szybkim zamówieniem z odbiorem na miejscu.",
      "Sprzedajemy napoje i wypieki oraz kawę w ziarnach. Zamówienia przyjmujemy w lokalu i przez stronę online, mamy kartę lojalnościową i profil w mediach społecznościowych.",
      "Najważniejsze są ekspres ciśnieniowy z młynkiem i wykwalifikowani bariści. Kawę kupujemy od lokalnej palarni, a wypieki od piekarni. Największe koszty to czynsz, wynagrodzenia baristów i zakup ziarna.",
      BUILD_FINAL_MESSAGE,
    ],
  },
  {
    id: "BUILD-02",
    kind: "BUILD",
    companyKey: "spotify",
    trueName: "Spotify",
    aliases: ["Daniel Ek", "Martin Lorentzon", "Lorentzon", "Discover Weekly", "Sztokholm"],
    outcome: "SUCCESS",
    description:
      "Firma A: usługa strumieniowania muzyki na żądanie w modelu freemium: bezpłatna wersja z reklamami i płatny abonament bez reklam.",
    messages: [
      "Pomóż mi zbudować model biznesowy. Firma A: usługa strumieniowania muzyki na żądanie w modelu freemium: bezpłatna wersja z reklamami i płatny abonament bez reklam.",
      "Odbiorcy to słuchacze korzystający z wersji bezpłatnej, słuchacze płacący za abonament oraz reklamodawcy, którzy chcą do nich dotrzeć.",
      "Obiecujemy ogromną bibliotekę muzyki dostępną od ręki, playlisty i rekomendacje dopasowane do słuchacza, a w wersji płatnej brak reklam i tryb offline.",
      "Docieramy przez aplikacje na telefony, komputery i głośniki oraz odtwarzacz w przeglądarce. Zarabiamy na abonamentach płatnych użytkowników i na reklamach w wersji bezpłatnej.",
      "Kluczowe są platforma streamingowa, licencje od wytwórni i wydawców oraz dane o słuchaniu. Największy koszt to opłaty licencyjne dla właścicieli praw do muzyki, potem infrastruktura i marketing.",
      BUILD_FINAL_MESSAGE,
    ],
  },
  {
    id: "BUILD-03",
    kind: "BUILD",
    companyKey: "quibi",
    trueName: "Quibi",
    aliases: ["Jeffrey Katzenberg", "Katzenberg", "Meg Whitman", "Whitman", "Turnstyle", "Quick Bites"],
    outcome: "FAILURE",
    description:
      "Firma B: płatna platforma krótkich materiałów wideo premium, tworzonych z myślą o oglądaniu na telefonie, w abonamencie z reklamami i bez reklam.",
    messages: [
      "Pomóż mi zbudować model biznesowy. Firma B: płatna platforma krótkich materiałów wideo premium, tworzonych z myślą o oglądaniu na telefonie, w abonamencie z reklamami i bez reklam.",
      "Odbiorcy to osoby oglądające na telefonie w drodze i w przerwach oraz reklamodawcy szukający treści premium na urządzeniach mobilnych.",
      "Oferujemy krótkie odcinki wysokiej jakości z udziałem znanych twórców i aktorów, w formacie dopasowanym do oglądania w pionie i w poziomie.",
      "Docieramy przez aplikację mobilną i kampanie reklamowe. Zarabiamy na abonamencie (tańszym z reklamami, droższym bez reklam) oraz na reklamach w wersji tańszej.",
      "Mamy duży budżet na produkcję treści, umowy ze znanymi twórcami i aplikację mobilną. Największy koszt to produkcja treści, potem marketing nowej marki oraz rozwój i utrzymanie aplikacji.",
      BUILD_FINAL_MESSAGE,
    ],
  },
  {
    id: "BUILD-04",
    kind: "BUILD",
    companyKey: "airbnb",
    trueName: "Airbnb",
    aliases: ["Air Bnb", "AirBed", "Brian Chesky", "Chesky", "Joe Gebbia", "Gebbia", "Blecharczyk", "Superhost"],
    outcome: "SUCCESS",
    description:
      "Firma C: internetowa platforma łącząca osoby oferujące pokoje lub całe mieszkania z podróżnymi szukającymi noclegu innego niż hotel; opłaty pobiera od obu stron.",
    messages: [
      "Pomóż mi zbudować model biznesowy. Firma C: internetowa platforma łącząca osoby oferujące pokoje lub całe mieszkania z podróżnymi szukającymi noclegu innego niż hotel; opłaty pobiera od obu stron.",
      "Klienci to gospodarze, którzy chcą zarobić na wolnej przestrzeni, oraz podróżni szukający tańszych lub bardziej lokalnych noclegów.",
      "Gospodarze dostają dodatkowy dochód i dostęp do wielu gości, a podróżni duży wybór cen i lokalizacji. Obie strony zyskują zaufanie dzięki opiniom i obsłudze płatności.",
      "Docieramy przez stronę internetową, aplikacje mobilne i reklamy w wyszukiwarkach. Zarabiamy na prowizji od gościa przy rezerwacji oraz na prowizji od gospodarza od zrealizowanych rezerwacji.",
      "Kluczowe są platforma z wyszukiwarką, rezerwacjami i płatnościami, baza ofert i opinii oraz weryfikacja użytkowników. Koszty to marketing, rozwój platformy, obsługa klienta i bezpieczeństwo oraz koszty płatności.",
      BUILD_FINAL_MESSAGE,
    ],
  },
  {
    id: "BUILD-05",
    kind: "BUILD",
    companyKey: "netflix",
    trueName: "Netflix",
    aliases: ["Reed Hastings", "Hastings", "Marc Randolph", "House of Cards", "Stranger Things"],
    outcome: "SUCCESS",
    description:
      "Firma D: usługa wideo na żądanie w miesięcznym abonamencie, z filmami i serialami własnymi oraz licencjonowanymi, bez reklam.",
    messages: [
      "Pomóż mi zbudować model biznesowy. Firma D: usługa wideo na żądanie w miesięcznym abonamencie, z filmami i serialami własnymi oraz licencjonowanymi, bez reklam.",
      "Odbiorcy to gospodarstwa domowe oglądające filmy i seriale na żądanie, także na rynkach poza krajem, w którym usługa powstała.",
      "Oferujemy dużą bibliotekę dostępną od ręki, treści własne dostępne tylko u nas i rekomendacje dopasowane do gustu widza.",
      "Docieramy przez aplikacje na telewizorach, konsolach i telefonach oraz w przeglądarce. Zarabiamy wyłącznie na miesięcznym abonamencie w kilku wariantach cenowych.",
      "Kluczowe są platforma dostarczania obrazu, dane o oglądalności i biblioteka treści. Największe koszty to produkcja i licencje na treści, potem infrastruktura i transfer danych oraz marketing.",
      BUILD_FINAL_MESSAGE,
    ],
  },
  {
    id: "BUILD-06",
    kind: "BUILD",
    companyKey: "blockbuster",
    trueName: "Blockbuster",
    aliases: ["Blockbuster Video", "John Antioco", "Antioco", "Wayne Huizenga", "Huizenga"],
    outcome: "FAILURE",
    description:
      "Firma E: sieć wypożyczalni filmów na nośnikach, działająca w sklepach stacjonarnych, w czasach przed upowszechnieniem streamingu.",
    messages: [
      "Pomóż mi zbudować model biznesowy. Firma E: sieć wypożyczalni filmów na nośnikach, działająca w sklepach stacjonarnych, w czasach przed upowszechnieniem streamingu.",
      "Klienci to rodziny wypożyczające filmy na wieczór oraz osoby chcące obejrzeć nowość bez kupowania nośnika.",
      "Oferujemy szeroki wybór nowości w jednym miejscu, wypożyczenie od ręki bez czekania na przesyłkę oraz przekąski przy kasie.",
      "Sprzedajemy wyłącznie przez sieć sklepów stacjonarnych, z obsługą przez pracowników i kartą członkowską. Zarabiamy na opłatach za wypożyczenie i za zwłokę w zwrocie oraz na sprzedaży nośników i przekąsek.",
      "Kluczowe są sieć lokali w dobrych lokalizacjach, zasób nośników i umowy z dystrybutorami filmowymi. Największe koszty to czynsze, wynagrodzenia pracowników sklepów oraz zakup i amortyzacja nośników.",
      BUILD_FINAL_MESSAGE,
    ],
  },
  {
    id: "BUILD-07",
    kind: "BUILD",
    companyKey: "juicero",
    trueName: "Juicero",
    aliases: ["Doug Evans"],
    outcome: "FAILURE",
    description:
      "Firma F: sprzedaż domowego urządzenia do wyciskania świeżych soków wraz z paczkami składników kupowanymi osobno i pasującymi tylko do tego urządzenia.",
    messages: [
      "Pomóż mi zbudować model biznesowy. Firma F: sprzedaż domowego urządzenia do wyciskania świeżych soków wraz z paczkami składników kupowanymi osobno i pasującymi tylko do tego urządzenia.",
      "Klienci to osoby gotowe zapłacić więcej za wygodę i świeży sok w domu.",
      "Obiecujemy świeży sok z jednej paczki bez mycia sprzętu, regularną dostawę składników do domu oraz urządzenie połączone z aplikacją.",
      "Sprzedajemy przez internet urządzenie i paczki, a paczki dostarczają firmy kurierskie. Zarabiamy na sprzedaży urządzenia i na sprzedaży paczek ze składnikami.",
      "Kluczowe są zaprojektowane urządzenie, sieć dostawców świeżych składników i własny system paczek dopasowanych do urządzenia. Koszty to produkcja zaawansowanego urządzenia, chłodzona logistyka paczek oraz rozwój produktu i marketing.",
      BUILD_FINAL_MESSAGE,
    ],
  },
];

const EVAL_COMPANY_ORDER: SeedKey[] = ["kawiarnia-ziarno", "spotify", "quibi", "airbnb", "netflix", "blockbuster", "juicero"];
const RAW_EVAL_CASES: EvalCase[] = EVAL_COMPANY_ORDER.map((companyKey, index) => ({
  id: `EVAL-0${index + 1}`,
  kind: "EVAL",
  companyKey,
}));

// Scenariusze z `docs/plan-pr-p.md` dosłownie (wiadomości i fikcyjna Kawiarnia Ziarno). S3 i S5 to jedna rozmowa w jednym
// projekcie (S5 kontynuuje S3, plus „Dziękuję.” jako ostatnia tura); S4 wymaga akcji „Analizuj wpływ” po turze 1.
const RAW_CHAT_CASES: ChatCase[] = [
  {
    id: "CHAT-S1",
    kind: "CHAT",
    fixture: "EMPTY",
    turns: [
      { type: "message", text: "Chcę otworzyć kawiarnię. Pomóż mi zbudować model biznesowy." },
      { type: "message", text: "Kawiarnia w centrum dużego miasta, kawa i proste śniadania." },
      { type: "message", text: "Nie mam jeszcze więcej szczegółów." },
      { type: "message", text: "To wszystko, co na razie wiem." },
      { type: "message", text: "Zaproponuj wpisy na podstawie tego, co napisałem." },
    ],
  },
  {
    id: "CHAT-S2",
    kind: "CHAT",
    fixture: "kawiarnia-ziarno",
    turns: [
      { type: "message", text: "Dodaj do segmentów klientów: rodziny z dziećmi." },
      { type: "message", text: "Dodaj do kanałów: dostawa przez aplikację mobilną." },
      { type: "message", text: "Dziękuję." },
    ],
  },
  {
    id: "CHAT-S3",
    kind: "CHAT",
    fixture: "kawiarnia-ziarno",
    turns: [{ type: "message", text: "Oceń mój model." }],
  },
  {
    id: "CHAT-S4",
    kind: "CHAT",
    fixture: "kawiarnia-ziarno",
    turns: [
      { type: "message", text: "Dodaj do strumieni przychodów: subskrypcja kawy miesięczna." },
      { type: "impact" },
      { type: "message", text: "Wyjaśnij mi wynik tej analizy." },
    ],
  },
  {
    id: "CHAT-S5",
    kind: "CHAT",
    fixture: "kawiarnia-ziarno",
    sameProjectAs: "CHAT-S3",
    turns: [
      { type: "message", text: "Dlaczego Innowacyjność dostała taką ocenę?" },
      { type: "message", text: "Dziękuję." },
    ],
  },
];

export const BUILD_CASES: readonly BuildCase[] = RAW_BUILD_CASES.map((c) => BuildCase.parse(c));
export const EVAL_CASES: readonly EvalCase[] = RAW_EVAL_CASES.map((c) => EvalCase.parse(c));
export const CHAT_CASES: readonly ChatCase[] = RAW_CHAT_CASES.map((c) => ChatCase.parse(c));
export const ALL_CASES: readonly EvalCaseDefinition[] = [...BUILD_CASES, ...EVAL_CASES, ...CHAT_CASES];

/** Wariant minimalny na start (D13): Kawiarnia Ziarno, Spotify, Quibi, Airbnb. */
export const MINIMAL_BUILD_CASE_IDS: readonly string[] = ["BUILD-01", "BUILD-02", "BUILD-03", "BUILD-04"];

export function getCase(id: string): EvalCaseDefinition | undefined {
  return ALL_CASES.find((c) => c.id === id);
}

/** Lista zakazanych tokenów przypadku BUILD: prawdziwa nazwa i aliasy. */
export function forbiddenTokens(buildCase: BuildCase): string[] {
  return [buildCase.trueName, ...buildCase.aliases];
}

function seedFor(key: SeedKey) {
  const company = SEED_COMPANIES.find((c) => c.key === key);
  if (!company) {
    throw new Error(`Brak firmy „${key}” w seedzie (companies.ts).`);
  }
  return { key: company.key, name: company.name, description: company.description, state: company.state };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Suma kontrolna zestawu: SHA-256 z kanonicznego JSON-a przypadków oraz firm z seeda, z których zestaw bierze stan
 * (`EVAL` i fixture'y `CHAT`). Zapisywana w `EvalRun.casesChecksum` i sprawdzana testem.
 */
export function casesChecksum(): string {
  const seedKeys = new Set<SeedKey>(EVAL_CASES.map((c) => c.companyKey));
  for (const c of CHAT_CASES) {
    if (c.fixture !== "EMPTY") seedKeys.add(c.fixture);
  }
  const payload = {
    build: BUILD_CASES,
    eval: EVAL_CASES,
    chat: CHAT_CASES,
    seeds: [...seedKeys].sort().map(seedFor),
  };
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}
