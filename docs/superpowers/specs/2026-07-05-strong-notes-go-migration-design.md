# Strong Notes: Go Backend + Scaffold-Based Mobile App — Design Spec

Date: 2026-07-05
Status: Approved for planning

## Problem

The original Strong Notes backend (Express/Prisma/TypeScript, single hardcoded
bearer token) and mobile app (Expo, custom auth/API client) were built,
tested, and live-tested end-to-end in a prior session — the app works. This
spec covers a deliberate architecture migration onto
[`DowLucas/app-scaffold`](https://github.com/DowLucas/app-scaffold), a
production-shaped Go + Expo starter Lucas maintains, to get real multi-user
auth (magic-link + JWT) and a more maintainable backend stack, rather than
continuing to build on the single-token prototype.

This is a full replacement, not a gradual migration: there is no production
data at stake yet, only test/seed data from the prior session's live testing.

## Scope

Two sub-projects, each with its own plan and implementation pass:

1. **Backend**: rewrite the Express/Prisma API as a Go service on the
   scaffold's Chi/sqlc/golang-migrate foundation, porting every existing
   domain table, endpoint, and business rule.
2. **Mobile**: rebuild the Expo app starting from the scaffold's app
   structure (design system, i18n, magic-link auth), porting Strong Notes'
   four screens and their already-tested local-first logic (SQLite repos,
   sync engine, quick-entry parsing, muscle-color science, components) into
   it.

Backend ships first and is validated end-to-end (tests + manual smoke test)
before the mobile rebuild begins, mirroring how the original TypeScript
build was sequenced.

## Architecture

Two deployables, same shape as the scaffold: a Go HTTP backend (Chi router,
sqlc-generated Postgres queries, golang-migrate SQL migrations) and an Expo
app (iOS/Android/Web), talking JSON over HTTP with the scaffold's protocol
version handshake (`X-Scaffold-App-Protocol` header, `426` on mismatch).

**Auth**: the scaffold's magic-link → JWT flow, used as-is. `DEV_MODE=true`
returns the magic-link token inline in the API response (no SMTP needed
yet — wire up real email delivery whenever this deploys somewhere beyond
Lucas's own phone). Sign-up is gated to an email allowlist (the scaffold's
`DEMO_LOGIN_EMAILS`-style pattern) containing just Lucas's email for now,
even though the underlying data model is genuinely multi-user — every
domain table already carries a real `user_id`.

**Unused scaffold subsystems**: S3/avatar storage (`S3_ENDPOINT` unset) and
the River background-job queue (`JOBS_ENABLED=false`) stay off. Nothing in
Strong Notes needs file uploads or async jobs; both are trivial to enable
later since the scaffold supports them natively.

## Domain model & backend logic

The existing Prisma schema ports 1:1 into golang-migrate SQL migrations:
`exercises`, `muscle_map_entries`, `abbreviations`, `workout_sessions`,
`set_entries`, `goals`, `goal_targets` — same columns, same unique
constraints (`exercises.name`, `(user_id, token)` on abbreviations,
`(user_id, date)` on sessions) — but `user_id` now foreign-keys to the
scaffold's real `users` table (ULID primary key) instead of being a
hardcoded string constant. sqlc-generated Go structs and query functions
replace the Prisma Client.

Every existing business rule ports verbatim, not redesigned:

- Dictionary-first resolution with LLM fallback only for unresolved tokens
  (`resolveLineWithDictionary` equivalent), numeric token exclusion regex
  unchanged.
- `POST /sessions/:date` upsert-and-replace-entries in one transaction.
- `POST /goals` deactivate-prior-then-create-new, static volume-science
  table (goal type × muscle → set range) as a plain Go map, unchanged
  numbers.
- `GET /goals/active/progress` aggregation: sum `set_entries.sets` through
  each entry's `exercises.muscle_map_entries`, matching the existing
  `if (!entry.exercise || !entry.sets) continue` skip behavior.
- `POST /exercises` and the now-idempotent `POST /abbreviations`
  find-or-create-on-conflict dedupe, including the empty-`muscles`-array
  allowance fixed during live testing.
- The `LlmProvider` interface with both Ollama and Anthropic
  implementations, same prompts (including the reps/sets-convention and
  real-exercise-name fixes from live testing), still synchronous — no job
  queue. The mobile app's existing "pending" UI already handles LLM latency
  gracefully, so there's no need to move this onto River.

Every domain route requires a valid JWT via the scaffold's `Authenticate`
middleware and derives `user_id` from the token claims — this fully replaces
the single-bearer-token model, not an addition alongside it.

## Mobile app

Start from the scaffold's Expo project: its design system, i18n plumbing
(English strings only for v1; the scaffolding itself supports more
languages later), and auth stack (`lib/auth.tsx`, `lib/storage.ts`,
`lib/discovery.ts`, `lib/protocol.ts`, the `(auth)/sign-in` magic-link
screen) are adopted as-is.

Strong Notes' four screens (Log, Stats, History, Profile) are added as new
tabs, replacing the scaffold's example `(tabs)/index`/`(tabs)/you` screens.
Everything that doesn't depend on the auth mechanism ports over largely
unchanged, since it was already built and tested independently of how
requests get authenticated:

- `src/db` — SQLite schema, sessions/abbreviations repos (including the
  test-only better-sqlite3 shim and its drift/isolation fixes)
- `src/sync` — the sync engine (push unsynced sessions, pull abbreviation
  dictionary)
- `src/parsing` — quick-entry orchestration, including local-dictionary-
  first resolution
- `src/science` — muscle-color mapping
- `src/components` — `ParsedLineRow` (including the confirm-loop
  `Pressable`), `MuscleHeatmap` (SVG body diagram)

What's replaced: the current `src/api/client.ts` (custom `request<T>` +
hardcoded bearer token) and `src/auth/token.ts` (SecureStore token
get/set, including its web `localStorage` fallback) are superseded by the
scaffold's JWT-based `lib/api.ts`/`lib/auth.tsx`, extended with Strong
Notes' domain endpoints (`resolveLine`, `resolveGoal`, `createExercise`,
`createAbbreviation`, `confirmAbbreviation`, `listAbbreviations`,
`putSession`, `getSessions`, `createGoal`, `getGoalProgress`). The Profile
screen's token-paste field is replaced by the scaffold's proper sign-in
flow; abbreviation-dictionary management and the API-token concept move
into whatever settings surface makes sense alongside the scaffold's
existing `(tabs)/you` conventions.

## Deployment & testing

Same target as today (Lucas's Proxmox homelab, existing Cloudflare Tunnel
wildcard ingress) adapted to the scaffold's Docker Compose conventions
(Postgres + backend container; no MinIO, since storage stays disabled).

Backend tests: Go's standard `testing` package plus the scaffold's
testcontainers-based integration harness, mirroring the existing
route-by-route test coverage (dictionary resolver, LLM provider factory
with a mocked/fake provider, sessions upsert-replace, goals progress
aggregation, exercises/abbreviations dedupe).

Mobile tests: same Jest/jest-expo/`@testing-library/react-native` stack;
the ported modules (`db`, `sync`, `parsing`, `science`, `components`) carry
their existing test suites over largely as-is, since their contracts don't
change. New tests are needed for the scaffold's auth flow integration and
the four screens in their new home.
