# BMC Agent

Aplikacja webowa z agentem AI do tworzenia, analizy i oceny modeli biznesowych (Business Model Canvas). Projekt w ramach pracy inżynierskiej.

- Specyfikacja: [`docs/spec.md`](docs/spec.md)
- Zasady pracy w repozytorium: [`CLAUDE.md`](CLAUDE.md)

## Wymagania

- Node.js 22 lub nowszy
- npm

## Uruchomienie

```bash
npm install
cp .env.example .env
npm run dev          # http://localhost:3000
```

## Komendy

```bash
npm run dev          # serwer deweloperski
npm run build        # build produkcyjny
npm run lint         # ESLint
npm run typecheck    # next typegen + tsc --noEmit
npm test             # testy jednostkowe (Vitest)
```
