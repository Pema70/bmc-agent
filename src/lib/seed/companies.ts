import { z } from "zod";
import { BmcState } from "../schemas/bmc";
import { PROJECT_DESCRIPTION_MAX_LENGTH, PROJECT_NAME_MAX_LENGTH } from "../schemas/project";

// Importy względne (bez aliasu @/): moduł ładuje też skrypt seeda uruchamiany poza Next.js i Vitestem.

export const SEED_PROJECT_PREFIX = "Seed: ";

export const SeedCompany = z.object({
  key: z.string().min(1),
  name: z.string().min(1).max(PROJECT_NAME_MAX_LENGTH),
  description: z.string().min(1).max(PROJECT_DESCRIPTION_MAX_LENGTH),
  outcome: z.enum(["SUCCESS", "FAILURE", "FICTIONAL"]),
  state: BmcState,
});
export type SeedCompany = z.infer<typeof SeedCompany>;

const SOURCE_NOTE =
  "Źródło: publicznie dostępne informacje (uproszczony opis, bez liczb; do weryfikacji przez autora przed użyciem w pracy).";

function describe(moment: string): string {
  return `Dane przykładowe. ${moment} ${SOURCE_NOTE}`;
}

const RAW_COMPANIES: SeedCompany[] = [
  {
    key: "netflix",
    name: `${SEED_PROJECT_PREFIX}Netflix`,
    outcome: "SUCCESS",
    description: describe(
      "Netflix (założony w 1997 roku): model usługi streamingu wideo w abonamencie, z okresu dojrzałej usługi, z treściami własnymi i licencjonowanymi.",
    ),
    state: {
      customer_segments: [
        "Gospodarstwa domowe oglądające filmy i seriale na żądanie",
        "Widzowie na wielu rynkach, także poza krajem pochodzenia usługi",
      ],
      value_propositions: [
        "Duża biblioteka filmów i seriali dostępna na żądanie",
        "Treści własne dostępne tylko w usłudze",
        "Rekomendacje dopasowane do gustu widza",
      ],
      channels: [
        "Aplikacje na telewizorach, konsolach, telefonach i w przeglądarce",
        "Strona internetowa z kontem i płatnościami",
      ],
      customer_relationships: [
        "Samoobsługowe konto z profilami domowników",
        "Spersonalizowane rekomendacje i powiadomienia o nowościach",
      ],
      revenue_streams: ["Miesięczny abonament w kilku wariantach cenowych"],
      key_resources: [
        "Platforma streamingowa i infrastruktura dostarczania obrazu",
        "Dane o oglądalności używane do rekomendacji i decyzji o treściach",
        "Biblioteka treści własnych i licencjonowanych",
      ],
      key_activities: [
        "Produkcja i zamawianie treści własnych",
        "Licencjonowanie treści od zewnętrznych producentów",
        "Rozwój platformy i algorytmów rekomendacji",
      ],
      key_partnerships: [
        "Studia filmowe i producenci treści",
        "Dostawcy infrastruktury chmurowej",
        "Producenci urządzeń z aplikacją usługi",
      ],
      cost_structure: [
        "Koszty produkcji i licencji na treści",
        "Koszty infrastruktury i transferu danych",
        "Marketing i rozwój platformy",
      ],
    },
  },
  {
    key: "airbnb",
    name: `${SEED_PROJECT_PREFIX}Airbnb`,
    outcome: "SUCCESS",
    description: describe(
      "Airbnb (założony w 2008 roku): model platformy dwustronnej łączącej gospodarzy oferujących noclegi z podróżnymi.",
    ),
    state: {
      customer_segments: [
        "Gospodarze wynajmujący pokoje lub całe mieszkania",
        "Podróżni szukający noclegu innego niż hotel",
      ],
      value_propositions: [
        "Gospodarze: dodatkowy dochód z wolnej przestrzeni i dostęp do wielu gości",
        "Podróżni: duży wybór noclegów w różnych cenach i lokalizacjach",
        "Zaufanie dzięki opiniom, profilom i obsłudze płatności",
      ],
      channels: ["Strona internetowa", "Aplikacje mobilne", "Wyszukiwarki i reklamy online"],
      customer_relationships: [
        "Samoobsługowe konta gospodarzy i gości",
        "System wzajemnych opinii",
        "Pomoc w sporach między gospodarzem a gościem",
      ],
      revenue_streams: ["Prowizja od gościa przy rezerwacji", "Prowizja od gospodarza od zrealizowanych rezerwacji"],
      key_resources: [
        "Platforma z wyszukiwarką, rezerwacjami i płatnościami",
        "Baza ofert i opinii",
        "Marka budująca zaufanie",
      ],
      key_activities: [
        "Rozwój i utrzymanie platformy",
        "Weryfikacja użytkowników i ofert",
        "Pozyskiwanie gospodarzy i gości",
      ],
      key_partnerships: ["Operatorzy płatności", "Firmy ubezpieczeniowe", "Fotografowie i usługodawcy dla gospodarzy"],
      cost_structure: ["Marketing", "Rozwój platformy", "Obsługa klienta i bezpieczeństwo", "Koszty płatności"],
    },
  },
  {
    key: "spotify",
    name: `${SEED_PROJECT_PREFIX}Spotify`,
    outcome: "SUCCESS",
    description: describe(
      "Spotify (założony w 2006 roku): model freemium z płatną subskrypcją, z okresu dojrzałej usługi streamingu muzyki.",
    ),
    state: {
      customer_segments: [
        "Słuchacze korzystający z bezpłatnej wersji z reklamami",
        "Słuchacze płacący za abonament",
        "Reklamodawcy docierający do słuchaczy",
      ],
      value_propositions: [
        "Dostęp do ogromnej biblioteki muzyki na żądanie",
        "Playlisty i rekomendacje dopasowane do słuchacza",
        "Wersja płatna bez reklam i z trybem offline",
      ],
      channels: ["Aplikacje na telefony, komputery i głośniki", "Odtwarzacz w przeglądarce", "Integracje z urządzeniami audio"],
      customer_relationships: [
        "Samoobsługowe konto i personalizacja",
        "Zachęty do przejścia z wersji bezpłatnej na płatną",
      ],
      revenue_streams: ["Abonamenty płatnych użytkowników", "Reklamy w wersji bezpłatnej"],
      key_resources: [
        "Platforma streamingowa",
        "Licencje na muzykę",
        "Dane o słuchaniu używane do rekomendacji",
      ],
      key_activities: [
        "Negocjowanie licencji z wytwórniami i wydawcami",
        "Rozwój aplikacji i rekomendacji",
        "Sprzedaż reklam",
      ],
      key_partnerships: ["Wytwórnie płytowe i wydawcy muzyczni", "Producenci urządzeń", "Operatorzy telekomunikacyjni"],
      cost_structure: [
        "Opłaty licencyjne dla właścicieli praw do muzyki",
        "Infrastruktura i rozwój platformy",
        "Marketing",
      ],
    },
  },
  {
    key: "blockbuster",
    name: `${SEED_PROJECT_PREFIX}Blockbuster`,
    outcome: "FAILURE",
    description: describe(
      "Blockbuster (ogłosił upadłość w 2010 roku): model sieci wypożyczalni stacjonarnych sprzed upowszechnienia streamingu.",
    ),
    state: {
      customer_segments: [
        "Rodziny wypożyczające filmy na wieczór",
        "Klienci chcący obejrzeć nowość bez kupowania nośnika",
      ],
      value_propositions: [
        "Szeroki wybór nowości na nośnikach w jednym miejscu",
        "Wypożyczenie od ręki, bez czekania na przesyłkę",
        "Przekąski i dodatki przy kasie",
      ],
      channels: ["Sieć sklepów stacjonarnych", "Późniejsze wypożyczenia wysyłkowe i online"],
      customer_relationships: [
        "Obsługa w sklepie przez pracowników",
        "Karta członkowska",
        "Przypomnienia o terminie zwrotu",
      ],
      revenue_streams: [
        "Opłaty za wypożyczenie nośników",
        "Opłaty za zwłokę w zwrocie",
        "Sprzedaż nośników i przekąsek",
      ],
      key_resources: [
        "Sieć lokali w dobrych lokalizacjach",
        "Zasób nośników z filmami",
        "Umowy z dystrybutorami filmowymi",
      ],
      key_activities: [
        "Zakup i dystrybucja nośników do sklepów",
        "Prowadzenie sklepów",
        "Zarządzanie ofertą nowości",
      ],
      key_partnerships: ["Studia filmowe i dystrybutorzy", "Wynajmujący lokale"],
      cost_structure: [
        "Czynsze za sieć sklepów",
        "Wynagrodzenia pracowników sklepów",
        "Zakup i amortyzacja nośników",
      ],
    },
  },
  {
    key: "quibi",
    name: `${SEED_PROJECT_PREFIX}Quibi`,
    outcome: "FAILURE",
    description: describe(
      "Quibi (uruchomiony i zamknięty w 2020 roku): model płatnej platformy krótkich materiałów wideo premium przeznaczonych na telefony.",
    ),
    state: {
      customer_segments: [
        "Użytkownicy telefonów oglądający krótkie materiały w drodze i w przerwach",
        "Reklamodawcy szukający treści premium na urządzeniach mobilnych",
      ],
      value_propositions: [
        "Krótkie odcinki wysokiej jakości, tworzone z myślą o telefonie",
        "Treści z udziałem znanych twórców i aktorów",
        "Format dopasowany do oglądania w pionie i w poziomie",
      ],
      channels: ["Aplikacja mobilna", "Kampanie reklamowe"],
      customer_relationships: ["Samoobsługowe konto w aplikacji", "Powiadomienia o nowych odcinkach"],
      revenue_streams: ["Abonament w wersji z reklamami i bez reklam", "Reklamy w wersji tańszej"],
      key_resources: [
        "Duży budżet na produkcję treści",
        "Umowy ze znanymi twórcami",
        "Aplikacja mobilna",
      ],
      key_activities: [
        "Zamawianie i produkcja krótkich seriali",
        "Marketing nowej marki",
        "Rozwój aplikacji",
      ],
      key_partnerships: ["Studia i producenci", "Znani twórcy i aktorzy", "Agencje reklamowe"],
      cost_structure: ["Produkcja treści", "Marketing nowej marki", "Rozwój i utrzymanie aplikacji"],
    },
  },
  {
    key: "juicero",
    name: `${SEED_PROJECT_PREFIX}Juicero`,
    outcome: "FAILURE",
    description: describe(
      "Juicero (zamknięty w 2017 roku): model sprzedaży urządzenia do wyciskania soków wraz z paczkami składników w subskrypcji.",
    ),
    state: {
      customer_segments: [
        "Zamożni miłośnicy zdrowego stylu życia",
        "Osoby ceniące wygodę przygotowania świeżego soku w domu",
      ],
      value_propositions: [
        "Świeży sok z jednej paczki, bez mycia sprzętu",
        "Składniki dostarczane regularnie do domu",
        "Urządzenie połączone z aplikacją",
      ],
      channels: ["Sprzedaż internetowa urządzenia i paczek", "Dostawa kurierska paczek"],
      customer_relationships: ["Konto klienta w aplikacji", "Obsługa klienta przez internet"],
      revenue_streams: ["Sprzedaż urządzenia", "Sprzedaż paczek ze składnikami"],
      key_resources: [
        "Zaprojektowane urządzenie z prasą",
        "Sieć dostawców świeżych składników",
        "Kapitał od inwestorów",
      ],
      key_activities: [
        "Projektowanie i produkcja urządzenia",
        "Pakowanie i dostawa świeżych paczek",
        "Rozwój aplikacji",
      ],
      key_partnerships: ["Rolnicy i dostawcy owoców i warzyw", "Producent urządzenia", "Firmy kurierskie"],
      cost_structure: [
        "Koszt produkcji zaawansowanego urządzenia",
        "Koszty chłodzonej logistyki paczek",
        "Rozwój produktu i marketing",
      ],
    },
  },
  {
    key: "kawiarnia-ziarno",
    name: `${SEED_PROJECT_PREFIX}Kawiarnia Ziarno`,
    outcome: "FICTIONAL",
    description:
      "Dane przykładowe. Kawiarnia w centrum miasta (firma fikcyjna: kontrola wpływu wiedzy modelu o znanych firmach).",
    state: {
      customer_segments: ["Studenci okolicznych uczelni", "Pracownicy biurowi z centrum"],
      value_propositions: [
        "Świeżo palona kawa speciality w cenie sieciówki",
        "Szybkie zamówienie z odbiorem na miejscu",
      ],
      channels: ["Lokal stacjonarny", "Strona zamówień online"],
      customer_relationships: ["Karta lojalnościowa", "Profil w mediach społecznościowych"],
      revenue_streams: ["Sprzedaż napojów i wypieków", "Sprzedaż kawy w ziarnach"],
      key_resources: ["Ekspres ciśnieniowy i młynek", "Wykwalifikowani bariści"],
      key_activities: ["Przygotowanie kawy", "Obsługa klientów w lokalu"],
      key_partnerships: ["Lokalna palarnia", "Piekarnia dostarczająca wypieki"],
      cost_structure: ["Czynsz za lokal", "Wynagrodzenia baristów", "Zakup ziarna"],
    },
  },
];

export const SEED_COMPANIES: readonly SeedCompany[] = RAW_COMPANIES.map((company) => SeedCompany.parse(company));
