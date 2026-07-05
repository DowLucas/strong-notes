# Log Screen: iOS-Notes-Style Redesign

**Goal:** Replace the current chat-log-style Log screen (a `FlatList` of parsed quick-entry rows plus a bottom text input) with a single continuous, freeform text editor that feels like the iOS Notes app — you write naturally, and the app quietly recognizes logged sets within your prose.

## Scope

- The entire Log screen (today's entry only — History stays a separate, already-shipped read-only tab, unchanged in this work) is redesigned.
- `session.notes` — a field already fully wired through SQLite, sync, and the backend, but with no UI anywhere today — becomes the actual text you type into. There is no separate "notes section"; the note *is* the log.
- Quick-entry parsing moves from "one line = one atomic entry" to scanning free-flowing prose for recognizable set phrases (Approach 1 below), extracting them as structured entries while leaving the surrounding prose as-is.
- Stats, History, You tabs are unaffected by this work.

## Parsing approach: anchor on numeric patterns

Today's parser (`src/parsing/quickEntry.ts`) treats an entire submitted line as one atomic quick-entry attempt. That assumption breaks once you can write multiple sentences of commentary mixed with logged sets in one continuous note.

Chosen approach: scan the note's text for the existing numeric-pattern anchors (`WEIGHT_TOKEN`, `REPS_SETS_TOKEN` — the regexes already in `quickEntry.ts`, e.g. `60kg`, `8x3`). For each anchor found, walk backward from it to the nearest sentence boundary (`.`, `,`, newline, or start of text) to capture the candidate clause (e.g. from "Felt strong today, did Bench Press 60kg 8x3, need to work on grip" the anchor `8x3` walks back to the clause "did Bench Press 60kg 8x3"). Feed that candidate clause through the *existing* dictionary-first → LLM-fallback resolution pipeline (`tryResolveLocally` → `api.resolveLine`) completely unchanged.

Rejected alternatives:
- **Keyword-triggered** ("did", "logged" + phrase) — more fragile, misses phrasings that don't use trigger words, and adds a new matching layer to maintain.
- **Full-paragraph LLM extraction** — simplest conceptually but breaks the "local-dictionary-first, no network dependency on common cases" constraint this app is built around, and adds real latency/cost on every ~700ms debounce tick while typing.

## Architecture

The Log screen becomes one continuous, auto-growing multi-line text surface — no `FlatList`, no bottom input bar. The live text is `session.notes`.

Two independent debounce timers drive persistence and parsing, decoupled so parsing latency never risks losing typed text:

- **Fast debounce (~300ms):** persists the raw note text to SQLite (`sessions.notes`) via the existing offline-first write path (SQLite always before any network call — unchanged constraint from the original migration plan).
- **Slower debounce (~700ms):** runs `extractCandidates(text, previousSpans)` to find candidate clauses via the anchor approach above, diffs them against the previously-known span list, and for each new/changed candidate re-runs local-dictionary-first → network-fallback resolution; for each candidate whose matched text is no longer present, deletes the corresponding entry.

Each stored `LocalSetEntry` gains span-tracking fields (start/end offset or matched-substring, exact shape decided during implementation) so re-scans can match a live span back to its existing entry and update it in place rather than duplicating it. Editing a previously-recognized phrase re-parses and updates that entry; deleting the phrase deletes the entry — **the text is the source of truth**, matching real Notes-app editing behavior (this was an explicit trade-off decision over "entries become independent once created," which was rejected as more prone to text/data drift).

`syncEngine`'s existing cadence and behavior are unchanged — it continues to push whatever `LocalSetEntry` rows exist, regardless of how they were created.

## Components

- **`NotesEditor`** (new) — the core continuous-text component. React Native's `TextInput` has no native support for styled inline sub-ranges, so this uses the standard overlay pattern: a transparent-background, editable `TextInput` stacked on top of a `Text` view rendering the same string with highlighted spans styled, using matching font metrics to stay pixel-aligned while typing.
  - **Known risk:** this overlay technique has real edge cases (multi-line reflow, cursor positioning, autocorrect/IME interaction). **Fallback if it proves too gnarly during implementation: ship without live inline highlighting first** (plain `TextInput`, parsing/persistence/entries all still work, just no visual markers), and add inline highlighting as a fast-follow once the core editor is solid.
- **`EntryPopover`** (new) — floating card shown when tapping a highlighted span. Shows parsed detail (exercise name, weight/reps/sets); for needs-confirm entries, a Confirm button wired to the existing `api.createExercise` + `api.createAbbreviation` calls (unchanged from today's confirm-loop).
- **`extractCandidates(text, previousSpans)`** (new, pure function in `src/parsing/`) — the anchor-finding + span-diffing logic described above. Fully unit-testable independent of any UI.
- Existing `parseQuickEntryLine`, `sessionsRepo`, `syncEngine`, `ApiClient` methods are reused as-is; `LocalSetEntry` gains the span-tracking fields.
- `ParsedLineRow` and the chat-row rendering retire from the Log screen (they were introduced in the original mobile migration plan's Task 6/7 and are no longer used there). History tab is unaffected by this work and keeps its own rendering.

## Visual design

Inline highlight style (validated via mockup, user-approved): a merged pill + underline — soft background fill (`colors.bone`) with a colored underline accent, matching the app's existing typography and paper/graphite palette. Three states, using existing color tokens:

- **Resolved** (clean dictionary match): moss-green pill + underline.
- **Needs confirm** (LLM guessed a new exercise): amber/citrine pill + underline — tapping opens `EntryPopover` with a Confirm action.
- **Unresolved** / not yet scanned: no highlight — stays plain text.

Tapping any highlighted (resolved or needs-confirm) span opens `EntryPopover` near the tap point.

## Error handling

- Raw note text always saves locally regardless of parse outcome — matches the existing "never block on network to show a just-logged entry" guarantee carried through the whole app.
- A candidate clause that fails to resolve (network/LLM unavailable) is simply left unhighlighted; there is no per-clause error UI. This matches the existing pattern elsewhere in the app of silently retrying on the next successful sync rather than surfacing granular network errors.
- Concurrent debounce ticks (a scan in flight while the user keeps typing) reuse the same serialized persist-queue technique already proven in the current Log screen's offline-first tests, adapted to the new component.

## Testing

- **`extractCandidates` (pure logic):** single clause found; multiple clauses in one paragraph; plain prose with no numeric anchor produces no candidates; editing a previously-found clause shifts/updates its span; deleting a clause's text removes it from the candidate set.
- **`NotesEditor` (component):** typing triggers the debounced persist and scan; a resolved candidate renders its inline highlight; tapping a resolved/needs-confirm span opens `EntryPopover` with correct content; confirming a needs-confirm entry updates its highlight to resolved.
- Regression coverage carried over and adapted from the current Log screen's tests: offline-first persistence (raw text and entries survive when parsing/network fails), rehydration of today's note on mount, and the confirm-loop (`createExercise` + `createAbbreviation` wiring).

## Out of scope

- History tab's visual rendering (kept as-is; a lighter aesthetic refresh may follow separately, not required for this to ship).
- Merging Log and History into a single Notes-style list+detail navigation (considered and explicitly rejected in favor of the smaller, "Log stays today-only" change).
- Looser prose-scanning beyond the numeric-anchor approach (e.g. full LLM paragraph extraction) — rejected due to the offline-first/no-network-per-keystroke constraint.
