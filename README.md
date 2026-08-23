# Strong Notes

Log your workouts as fast as free text — get real data back.

Strong Notes is a gym logger built on a simple premise: the fastest way to log a
workout is the way people already do it — a few lines of shorthand in a notes app,
no tapping through pickers and modals. Strong Notes reads that shorthand, understands
it, and turns it into structured data: session history and, per exercise, a
progress view — top-set weight over time, estimated 1RM, volume, and your PRs.

You type:

```
BB RDL 40kgx8 50kgx8x4
Bench 60kg 8x3
  ⁃ 65kg 6x2
```

Strong Notes parses it into exercises, weights, reps, and sets — resolving your
personal abbreviations along the way — and files it under the right muscles.

## The idea: packed notation

The distinctive feature is a parser that reads dense, free-text gym shorthand the way
people actually write it:

- **Packed tokens** — `40kgx8x2` means weight × reps × sets.
- **Multiple set-groups per line** — `BB RDL 40kgx8 50kgx8x4` becomes one entry per
  group under the same exercise.
- **`bar` loads** — weight left unknown when you just note the movement.
- **Continuation lines** — an indented `⁃` line inherits the exercise from the line
  above.
- **Prose** — "did Bench Press 60kg 8x3" works too.
- **Weight first** — `30kg bb deadlifts 8x3` puts the load ahead of the name.
- **Loose spacing and `@`** — `8 x 3`, `30 kg`, `30kg x 8 x 3`, `3x8 @ 30kg` all read
  the same as their compact forms.
- **Rep lists** — `30kg 8,8,6` (or `30kgx8,8,6`) is one set per entry.

Shorthand the parser doesn't recognize is resolved through a dictionary → LLM
pipeline, and only saved to your personal dictionary once you confirm it with a tap.

Parsing lives in [`mobile/src/parsing/`](mobile/src/parsing/) (client-side, offline)
with server-side resolution in [`backend/internal/parsing`](backend/internal/parsing)
and [`backend/internal/llm`](backend/internal/llm).

## Repository layout

| Path                 | What it holds                                                            |
| -------------------- | ------------------------------------------------------------------------ |
| `backend/`           | Go API — auth, exercises, goals, sessions, shorthand resolution, storage |
| `mobile/`            | Expo / React Native app (iOS-first), offline-first with SQLite           |
| `docs/`              | Design specs and implementation plans                                    |

## Backend (`backend/`)

Go 1.25 API using [chi](https://github.com/go-chi/chi) for routing and PostgreSQL via
[pgx](https://github.com/jackc/pgx) with [sqlc](https://sqlc.dev)-generated queries.
Migrations ([golang-migrate](https://github.com/golang-migrate/migrate)) run on
startup. Auth is JWT-backed magic links. Background jobs use
[River](https://riverqueue.com); S3-compatible object storage is optional; shorthand
resolution uses the Anthropic API or a local Ollama model.

### Run locally

```bash
cd backend
cp .env.example .env.local        # fill in DATABASE_URL, JWT_SECRET, etc.
docker compose --env-file .env.local up -d --build   # backend on :8080, Postgres on :5432
```

Or without Docker, with a Postgres you provide:

```bash
cd backend
make migrate-up      # needs DATABASE_URL
make build && ./bin/api
```

Common Make targets: `make generate` (sqlc codegen), `make test` /
`make test-unit` / `make test-integration`, `make lint`, `make migrate-create name=...`.
See [`backend/DEPLOY.md`](backend/DEPLOY.md) for production deployment.

Configuration is via environment variables — see
[`backend/.env.example`](backend/.env.example) for the full list. The minimum to boot
is `DATABASE_URL`, `POSTGRES_PASSWORD`, and `JWT_SECRET`.

## Mobile (`mobile/`)

Expo SDK 54 / React Native app (TypeScript), offline-first via `expo-sqlite`, with
[Expo Router](https://docs.expo.dev/router/introduction/) for navigation,
`react-native-svg` for the progress charts, and i18n through `i18next`.

### Run

```bash
cd mobile
npm install
npm run start        # then press i (iOS), a (Android), or w (web)
```

Point the app at your backend with `EXPO_PUBLIC_API_URL` (defaults to
`http://localhost:8080`). Tests: `npm test`.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache License 2.0](LICENSE) © 2026 Lucas Dow.
