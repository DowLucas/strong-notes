# Strong Notes — Design Spec

Date: 2026-07-04
Status: Approved for planning

## Problem

Lucas has used the iPhone Notes app as a gym log for ~5 years, using personal
shorthand (e.g. `RDL`, `BB`, `HT`, `CC` for supersets) because every gym app
he's tried adds too much friction — tapping through exercise pickers, weight
selectors, and rep/set fields for every single line. He wants an app that logs
as fast as free text but gives back the data and science-based tracking that
Notes can't: sets-per-muscle-per-week vs. goal, history, and trends. He also
wants it to default to a female muscular figure for visual feedback, since
every mainstream gym app defaults to a male body.

## v1 Scope

- Fast free-text quick logging with an editable personal shorthand dictionary
- LLM fallback (cheap cloud model) to resolve unrecognized shorthand, with
  one-tap confirm before it's saved permanently to the dictionary
- Goal setting: preset picker (hypertrophy / strength / endurance / custom)
  or free-text ("I want a bigger booty") translated by the same LLM fallback
  into a target muscle emphasis
- Science-based static table mapping exercises → muscles and goal type →
  weekly set-volume ranges; this table (not the LLM) drives all volume math
- Muscle heatmap visualization (front/back body diagram, female figure
  default) showing sets done vs. target per muscle group this week
- History view of past sessions, searchable/filterable
- Local-first storage (instant logging, offline-friendly) syncing to a
  Postgres backend for backup and future multi-device/multi-user support

### Explicitly out of scope for v1 (fast-follow / v2)

- Post-workout mood/rating capture
- "How do you feel today" → suggested workout adjustments
- Adaptive suggestions based on rating history over time
- Android build (schema/code should not preclude it, but no v1 QA effort)
- Multi-user accounts (schema supports it, no UI/auth for it yet)

## Architecture

**Frontend:** React Native + Expo, TypeScript, iOS first.
- `expo-sqlite` for local-first storage — all writes hit local SQLite
  immediately so logging is instant even offline.
- Expo SecureStore holds the API bearer token.
- Background sync pushes local changes to the backend when online; Postgres
  is the source of truth for backup/multi-device.

**Backend:** Node/Express service in a new Docker stack on Lucas's Proxmox
homelab (`/opt/stacks/strong-notes-api/`), following the existing
[[proxmox-lurkhuset]] conventions:
- Postgres bind-mounted to `/tank/apps/strong-notes/pgdata` (ZFS dataset,
  owned by postgres UID 999).
- Exposed publicly via the existing Cloudflare Tunnel at
  `strong-notes-api.lurkhuset.com` (works over cellular, not just home wifi
  or Tailscale).
- Auth: single long-lived bearer token (env var on server, SecureStore on
  device) — acceptable for solo use now; schema/API shape should not block
  swapping in real multi-user auth (e.g. Supabase Auth/Clerk) later.
- Add to Uptime Kuma once deployed, same as other services.

**LLM proxy:** the backend exposes an internal `/resolve` endpoint used for
both (a) unrecognized shorthand resolution and (b) free-text goal
translation. The provider is swappable via env var:
- Dev/testing: local Ollama (e.g. Gemma 2 2B or Llama 3.2 3B) — free, fast
  iteration, no API cost.
- Production: cheap cloud model (Claude Haiku or Gemini Flash) — called only
  on dictionary/goal-preset misses, so real-world volume and cost stay low.

## Data Model

- **Exercise** — canonical name, category (compound/isolation), `muscle_map`
  (list of {muscle, role: primary/secondary, contribution weight})
- **Abbreviation** — shorthand token → Exercise or modifier (equipment marker
  like `BB`/`DB`, or structural marker like superset `CC`), `source`:
  `built-in` | `user-added` | `llm-suggested-pending-confirm`
- **WorkoutSession** — date, optional session notes/rating, has many
  `SetEntry`
- **SetEntry** — exercise ref, equipment, weight, reps, sets, raw original
  text (kept for parser audit/debugging), `parsed_by`: `dictionary` | `llm`
- **Goal** — type (hypertrophy/strength/endurance/custom), target muscles +
  weekly set ranges (defaulted from the static science table, user-overridable)
- **MuscleGroup** — fixed taxonomy: glutes, quads, hamstrings, chest, back,
  shoulders, arms, core, calves — used by both the science table and the
  heatmap
- All tables carry a `user_id` from day one (single row today) so multi-user
  is additive, not a migration.

### Parsing pipeline (per logged line)

1. Tokenize the line; look up each token against the Abbreviation dictionary
   (instant, offline).
2. Any unresolved token → send the full line + context to the LLM `/resolve`
   endpoint → get back a structured guess (exercise, equipment, weight, reps,
   sets).
3. Show the parsed result inline as one-tap confirm/edit chips before saving
   — nothing is silently guessed into permanent data.
4. On confirm, if the line used an LLM-resolved token, offer to save it to
   the Abbreviation dictionary permanently (source: `llm-suggested-pending-confirm`
   → `user-added`) so the same shorthand is never re-resolved by the LLM again.

## Screens & Navigation

Bottom tab bar, 4 tabs:

1. **Log** (home tab) — today's session as a running list of quick-entry
   lines, single text input at the bottom, parsed lines shown above with
   inline confirm chips. Date picker/swipe to view other sessions.
2. **Stats** — muscle heatmap (front/back, female figure default, toggleable),
   tap a muscle for sets-this-week vs. target and a trend line over past
   weeks. Goal editor accessible from here.
3. **History** — chronological list of past sessions, searchable/filterable
   by exercise or date, expandable to full session detail.
4. **Profile** — abbreviation dictionary management (view/edit/add), current
   goal summary, sync status, token/account settings.

There is no separate "start new workout" flow — opening the Log tab and
typing *is* starting a session, matching the Notes-app speed Lucas wants to
keep.

## Testing Approach

- Backend: unit tests for the parsing pipeline (dictionary resolution, LLM
  fallback contract) and the volume-math functions (sets/week vs. goal
  table), run against local Ollama in CI/dev to avoid cloud LLM cost/flake.
- Frontend: component tests for the quick-entry parser UI (confirm/edit
  chip flow) and the muscle heatmap rendering given sample volume data.
- Manual QA on-device (Expo) for the core logging loop before each release,
  since typing feel/speed is the whole point of the product.
