# BMC Agent

Aplikacja webowa z agentem AI do tworzenia, analizy i oceny modeli biznesowych (Business Model Canvas). Projekt w ramach pracy inżynierskiej.

- Specyfikacja: [`docs/spec.md`](docs/spec.md)
- Zasady pracy w repozytorium: [`CLAUDE.md`](CLAUDE.md)

## Wymagania

- Node.js 22 lub nowszy
- npm
- Docker (lokalny PostgreSQL)

## Uruchomienie

```bash
npm install                 # uruchamia też prisma generate
cp .env.example .env
docker compose up -d db     # Postgres 18 na porcie hosta 5433
npx prisma migrate dev      # migracje
npm run dev                 # http://localhost:3000
```

Kontener bazy wystawia port **5433**, żeby nie kolidować z lokalnie zainstalowanym Postgresem na 5432.

## Komendy

```bash
npm run dev          # serwer deweloperski
npm run build        # build produkcyjny
npm run lint         # ESLint
npm run typecheck    # next typegen + tsc --noEmit
npm test             # testy jednostkowe (Vitest)
```
