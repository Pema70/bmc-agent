import { createHash } from "node:crypto";
import { z } from "zod";
import { BLOCK_KEYS, BlockKey } from "@/lib/schemas/bmc";
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
  /** Wewnętrzna etykieta anonimizacji („Firma A”); tylko klucz wyników, nigdy w wiadomościach ani opisie. */
  label: z.string().optional(),
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
  /** Bloki BMC opisane w kolejnych wiadomościach (ta sama długość co `messages`); łącznie muszą dać komplet 9 bloków. */
  coverage: z.array(z.array(BlockKey)).length(6),
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
    description: "Planuję kawiarnię w centrum dużego miasta: kawa speciality i proste śniadania.",
    messages: [
      "Chcę otworzyć kawiarnię. Pomóż mi zbudować model biznesowy. Planuję kawiarnię w centrum dużego miasta: kawa speciality i proste śniadania.",
      "Klienci to głównie studenci okolicznych uczelni i pracownicy biur z centrum. Mamy kartę lojalnościową i prowadzimy profil w mediach społecznościowych.",
      "Wyróżniamy się świeżo paloną kawą speciality w cenie sieciówki i szybkim zamówieniem z odbiorem na miejscu. Klienci przychodzą do lokalu stacjonarnego albo zamawiają przez stronę online.",
      "Sprzedajemy napoje i wypieki oraz kawę w ziarnach. Najważniejsze działania to przygotowywanie kawy i obsługa klientów w lokalu.",
      "Najważniejsze zasoby to ekspres ciśnieniowy z młynkiem i wykwalifikowani bariści. Współpracujemy z lokalną palarnią i z piekarnią, która dostarcza wypieki. Największe koszty to czynsz za lokal, wynagrodzenia baristów i zakup ziarna.",
      BUILD_FINAL_MESSAGE,
    ],
    coverage: [
      [],
      ["customer_segments", "customer_relationships"],
      ["value_propositions", "channels"],
      ["revenue_streams", "key_activities"],
      ["key_resources", "key_partnerships", "cost_structure"],
      [],
    ],
  },
  {
    id: "BUILD-02",
    kind: "BUILD",
    label: "Firma A",
    companyKey: "spotify",
    trueName: "Spotify",
    aliases: ["Daniel Ek", "Martin Lorentzon", "Lorentzon", "Discover Weekly", "Sztokholm"],
    outcome: "SUCCESS",
    description:
      "Prowadzę usługę strumieniowania muzyki na żądanie w modelu freemium: bezpłatna wersja z reklamami i płatny abonament bez reklam.",
    messages: [
      "Pomóż mi zbudować model biznesowy. Prowadzę usługę strumieniowania muzyki na żądanie w modelu freemium: bezpłatna wersja z reklamami i płatny abonament bez reklam.",
      "Odbiorcy to słuchacze korzystający z wersji bezpłatnej z reklamami, słuchacze płacący za abonament oraz reklamodawcy, którzy chcą do nich dotrzeć. Słuchacze mają samoobsługowe konto z personalizacją, a my zachęcamy ich do przejścia z wersji bezpłatnej na płatną.",
      "Obiecujemy ogromną bibliotekę muzyki na żądanie, playlisty i rekomendacje dopasowane do słuchacza oraz wersję płatną bez reklam i z trybem offline. Docieramy przez aplikacje na telefony, komputery i głośniki, odtwarzacz w przeglądarce i integracje z urządzeniami audio.",
      "Zarabiamy na abonamentach płatnych użytkowników i na reklamach w wersji bezpłatnej. Najważniejsze działania to negocjowanie licencji z wytwórniami i wydawcami, rozwój aplikacji i rekomendacji oraz sprzedaż reklam.",
      "Kluczowe zasoby to platforma streamingowa, licencje na muzykę i dane o słuchaniu używane do rekomendacji. Partnerzy to wytwórnie płytowe i wydawcy muzyczni, producenci urządzeń oraz operatorzy telekomunikacyjni. Koszty to opłaty licencyjne dla właścicieli praw do muzyki, infrastruktura i rozwój platformy oraz marketing.",
      BUILD_FINAL_MESSAGE,
    ],
    coverage: [
      [],
      ["customer_segments", "customer_relationships"],
      ["value_propositions", "channels"],
      ["revenue_streams", "key_activities"],
      ["key_resources", "key_partnerships", "cost_structure"],
      [],
    ],
  },
  {
    id: "BUILD-03",
    kind: "BUILD",
    label: "Firma B",
    companyKey: "quibi",
    trueName: "Quibi",
    aliases: ["Jeffrey Katzenberg", "Katzenberg", "Meg Whitman", "Whitman", "Turnstyle", "Quick Bites"],
    outcome: "FAILURE",
    description:
      "Prowadzę płatną platformę krótkich materiałów wideo premium, tworzonych z myślą o oglądaniu na telefonie, w abonamencie z reklamami i bez reklam.",
    messages: [
      "Pomóż mi zbudować model biznesowy. Prowadzę płatną platformę krótkich materiałów wideo premium, tworzonych z myślą o oglądaniu na telefonie, w abonamencie z reklamami i bez reklam.",
      "Odbiorcy to użytkownicy telefonów oglądający krótkie materiały w drodze i w przerwach oraz reklamodawcy szukający treści premium na urządzeniach mobilnych. Użytkownicy mają samoobsługowe konto w aplikacji i dostają powiadomienia o nowych odcinkach.",
      "Oferujemy krótkie odcinki wysokiej jakości, tworzone z myślą o telefonie, z udziałem znanych twórców i aktorów, w formacie dopasowanym do oglądania w pionie i w poziomie. Docieramy przez aplikację mobilną i kampanie reklamowe.",
      "Zarabiamy na abonamencie w wersji z reklamami i bez reklam oraz na reklamach w wersji tańszej. Najważniejsze działania to zamawianie i produkcja krótkich seriali, marketing nowej marki i rozwój aplikacji.",
      "Kluczowe zasoby to duży budżet na produkcję treści, umowy ze znanymi twórcami i aplikacja mobilna. Partnerzy to studia i producenci, znani twórcy i aktorzy oraz agencje reklamowe. Koszty to produkcja treści, marketing nowej marki oraz rozwój i utrzymanie aplikacji.",
      BUILD_FINAL_MESSAGE,
    ],
    coverage: [
      [],
      ["customer_segments", "customer_relationships"],
      ["value_propositions", "channels"],
      ["revenue_streams", "key_activities"],
      ["key_resources", "key_partnerships", "cost_structure"],
      [],
    ],
  },
  {
    id: "BUILD-04",
    kind: "BUILD",
    label: "Firma C",
    companyKey: "airbnb",
    trueName: "Airbnb",
    aliases: ["Air Bnb", "AirBed", "Air Bed", "Brian Chesky", "Chesky", "Joe Gebbia", "Gebbia", "Blecharczyk", "Superhost"],
    outcome: "SUCCESS",
    description:
      "Prowadzę internetową platformę łączącą osoby oferujące pokoje lub całe mieszkania z podróżnymi szukającymi noclegu innego niż hotel; pobieramy opłaty od obu stron.",
    messages: [
      "Pomóż mi zbudować model biznesowy. Prowadzę internetową platformę łączącą osoby oferujące pokoje lub całe mieszkania z podróżnymi szukającymi noclegu innego niż hotel; pobieramy opłaty od obu stron.",
      "Klienci to gospodarze wynajmujący pokoje lub całe mieszkania oraz podróżni szukający noclegu innego niż hotel. Gospodarze i goście mają samoobsługowe konta, wystawiają sobie wzajemne opinie, a my pomagamy w sporach między gospodarzem a gościem.",
      "Gospodarze dostają dodatkowy dochód z wolnej przestrzeni i dostęp do wielu gości, podróżni duży wybór noclegów w różnych cenach i lokalizacjach, a obie strony zaufanie dzięki opiniom, profilom i obsłudze płatności. Docieramy przez stronę internetową, aplikacje mobilne oraz wyszukiwarki i reklamy online.",
      "Zarabiamy na prowizji od gościa przy rezerwacji i na prowizji od gospodarza od zrealizowanych rezerwacji. Najważniejsze działania to rozwój i utrzymanie platformy, weryfikacja użytkowników i ofert oraz pozyskiwanie gospodarzy i gości.",
      "Kluczowe zasoby to platforma z wyszukiwarką, rezerwacjami i płatnościami, baza ofert i opinii oraz marka budująca zaufanie. Partnerzy to operatorzy płatności, firmy ubezpieczeniowe oraz fotografowie i usługodawcy dla gospodarzy. Koszty to marketing, rozwój platformy, obsługa klienta i bezpieczeństwo oraz koszty płatności.",
      BUILD_FINAL_MESSAGE,
    ],
    coverage: [
      [],
      ["customer_segments", "customer_relationships"],
      ["value_propositions", "channels"],
      ["revenue_streams", "key_activities"],
      ["key_resources", "key_partnerships", "cost_structure"],
      [],
    ],
  },
  {
    id: "BUILD-05",
    kind: "BUILD",
    label: "Firma D",
    companyKey: "netflix",
    trueName: "Netflix",
    aliases: ["Reed Hastings", "Hastings", "Marc Randolph", "House of Cards", "Stranger Things"],
    outcome: "SUCCESS",
    description:
      "Prowadzę usługę wideo na żądanie w miesięcznym abonamencie, z filmami i serialami własnymi oraz licencjonowanymi, bez reklam.",
    messages: [
      "Pomóż mi zbudować model biznesowy. Prowadzę usługę wideo na żądanie w miesięcznym abonamencie, z filmami i serialami własnymi oraz licencjonowanymi, bez reklam.",
      "Odbiorcy to gospodarstwa domowe oglądające filmy i seriale na żądanie oraz widzowie na wielu rynkach, także poza krajem, w którym usługa powstała. Widzowie mają samoobsługowe konto z profilami domowników i dostają spersonalizowane rekomendacje oraz powiadomienia o nowościach.",
      "Oferujemy dużą bibliotekę filmów i seriali dostępną na żądanie, treści własne dostępne tylko w usłudze i rekomendacje dopasowane do gustu widza. Docieramy przez aplikacje na telewizorach, konsolach, telefonach i w przeglądarce oraz stronę internetową z kontem i płatnościami.",
      "Zarabiamy na miesięcznym abonamencie w kilku wariantach cenowych. Najważniejsze działania to produkcja i zamawianie treści własnych, licencjonowanie treści od zewnętrznych producentów oraz rozwój platformy i algorytmów rekomendacji.",
      "Kluczowe zasoby to platforma streamingowa z infrastrukturą dostarczania obrazu, dane o oglądalności używane do rekomendacji i decyzji o treściach oraz biblioteka treści własnych i licencjonowanych. Partnerzy to studia filmowe i producenci treści, dostawcy infrastruktury chmurowej oraz producenci urządzeń z aplikacją usługi. Koszty to produkcja i licencje na treści, infrastruktura i transfer danych oraz marketing i rozwój platformy.",
      BUILD_FINAL_MESSAGE,
    ],
    coverage: [
      [],
      ["customer_segments", "customer_relationships"],
      ["value_propositions", "channels"],
      ["revenue_streams", "key_activities"],
      ["key_resources", "key_partnerships", "cost_structure"],
      [],
    ],
  },
  {
    id: "BUILD-06",
    kind: "BUILD",
    label: "Firma E",
    companyKey: "blockbuster",
    trueName: "Blockbuster",
    aliases: ["Blockbuster Video", "John Antioco", "Antioco", "Wayne Huizenga", "Huizenga"],
    outcome: "FAILURE",
    description:
      "Prowadzę sieć wypożyczalni filmów na nośnikach, działającą w sklepach stacjonarnych, w czasach przed upowszechnieniem streamingu.",
    messages: [
      "Pomóż mi zbudować model biznesowy. Prowadzę sieć wypożyczalni filmów na nośnikach, działającą w sklepach stacjonarnych, w czasach przed upowszechnieniem streamingu.",
      "Klienci to rodziny wypożyczające filmy na wieczór oraz osoby chcące obejrzeć nowość bez kupowania nośnika. Obsługują ich pracownicy w sklepie, a stałych klientów obejmuje karta członkowska.",
      "Oferujemy szeroki wybór nowości na nośnikach w jednym miejscu, wypożyczenie od ręki bez czekania na przesyłkę oraz przekąski i dodatki przy kasie. Sprzedajemy wyłącznie przez sieć sklepów stacjonarnych.",
      "Zarabiamy na opłatach za wypożyczenie nośników, opłatach za zwłokę w zwrocie oraz sprzedaży nośników i przekąsek. Najważniejsze działania to zakup i dystrybucja nośników do sklepów, prowadzenie sklepów oraz zarządzanie ofertą nowości.",
      "Kluczowe zasoby to sieć lokali w dobrych lokalizacjach, zasób nośników z filmami i umowy z dystrybutorami filmowymi. Partnerzy to studia filmowe i dystrybutorzy oraz wynajmujący lokale. Koszty to czynsze za sieć sklepów, wynagrodzenia pracowników sklepów oraz zakup i amortyzacja nośników.",
      BUILD_FINAL_MESSAGE,
    ],
    coverage: [
      [],
      ["customer_segments", "customer_relationships"],
      ["value_propositions", "channels"],
      ["revenue_streams", "key_activities"],
      ["key_resources", "key_partnerships", "cost_structure"],
      [],
    ],
  },
  {
    id: "BUILD-07",
    kind: "BUILD",
    label: "Firma F",
    companyKey: "juicero",
    trueName: "Juicero",
    aliases: ["Doug Evans"],
    outcome: "FAILURE",
    description:
      "Prowadzę sprzedaż domowego urządzenia do wyciskania świeżych soków wraz z paczkami składników kupowanymi osobno i pasującymi tylko do tego urządzenia.",
    messages: [
      "Pomóż mi zbudować model biznesowy. Prowadzę sprzedaż domowego urządzenia do wyciskania świeżych soków wraz z paczkami składników kupowanymi osobno i pasującymi tylko do tego urządzenia.",
      "Klienci to osoby gotowe zapłacić więcej za wygodę i świeży sok w domu oraz osoby ceniące wygodę przygotowania świeżego soku w domu. Mają konto klienta w aplikacji i obsługę klienta przez internet.",
      "Obiecujemy świeży sok z jednej paczki bez mycia sprzętu, regularną dostawę składników do domu oraz urządzenie połączone z aplikacją. Sprzedajemy przez internet urządzenie i paczki, a paczki dostarczają firmy kurierskie.",
      "Zarabiamy na sprzedaży urządzenia i na sprzedaży paczek ze składnikami. Najważniejsze działania to projektowanie i produkcja urządzenia, pakowanie i dostawa świeżych paczek oraz rozwój aplikacji.",
      "Kluczowe zasoby to zaprojektowane urządzenie z prasą, sieć dostawców świeżych składników i własny system paczek dopasowanych do urządzenia. Partnerzy to rolnicy i dostawcy owoców i warzyw, producent urządzenia oraz firmy kurierskie. Koszty to produkcja zaawansowanego urządzenia, chłodzona logistyka paczek oraz rozwój produktu i marketing.",
      BUILD_FINAL_MESSAGE,
    ],
    coverage: [
      [],
      ["customer_segments", "customer_relationships"],
      ["value_propositions", "channels"],
      ["revenue_streams", "key_activities"],
      ["key_resources", "key_partnerships", "cost_structure"],
      [],
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

/** Bloki opisane w wiadomościach przypadku BUILD (suma po wiadomościach, w kolejności bloków BMC). */
export function coveredBlocks(buildCase: BuildCase): string[] {
  const covered = new Set<string>(buildCase.coverage.flat());
  return BLOCK_KEYS.filter((key) => covered.has(key));
}

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
