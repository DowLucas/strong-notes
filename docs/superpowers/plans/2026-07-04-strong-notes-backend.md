# Strong Notes Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Postgres-backed API (schema, auth, shorthand/goal resolution via a swappable LLM provider, sync endpoints, and homelab deployment) that the Strong Notes mobile app will sync against.

**Architecture:** Node.js + TypeScript + Express, Prisma ORM over Postgres. A single bearer token protects all routes. An `LlmProvider` interface abstracts shorthand/goal resolution, with an Ollama implementation for local dev and an Anthropic (Claude Haiku) implementation for production, selected by `LLM_PROVIDER` env var. Deployed as a new Docker stack on the Proxmox homelab, exposed via the existing Cloudflare Tunnel.

**Tech Stack:** Node.js 24, TypeScript, Express, Prisma + PostgreSQL, Zod (request validation), Vitest + Supertest (testing), tsx (dev runner), Docker Compose.

## Global Constraints

- Backend lives in `backend/` at the repo root (mobile app will live in `mobile/`, added in the follow-up plan).
- Every table has a `userId` column (default `"lucas"`) per spec — single-user today, additive for multi-user later.
- Static science table (goal type → muscle → weekly set range) drives all volume math; the LLM is never used for volume numbers, only for text resolution (per spec).
- All API routes require `Authorization: Bearer <API_TOKEN>` except `/health`.
- LLM provider must be swappable via `LLM_PROVIDER=ollama|anthropic` env var without code changes to callers.
- Deployment follows the existing Proxmox homelab conventions: Docker stack in `/opt/stacks/strong-notes-api/`, Postgres data on ZFS at `/tank/apps/strong-notes/pgdata`, Caddy block, public via the existing Cloudflare Tunnel.

---

## File Structure

```
backend/
  package.json
  tsconfig.json
  .env.example
  vitest.config.ts
  Dockerfile
  docker-compose.yml
  prisma/
    schema.prisma
    seed.ts
  src/
    server.ts               # Express app wiring, entrypoint
    db.ts                    # Prisma client singleton
    middleware/
      auth.ts                # bearer token check
    science/
      muscleGroups.ts         # fixed MuscleGroup list + labels
      volumeTable.ts           # goal type -> muscle -> {min,max} sets/week
    parsing/
      dictionaryResolver.ts    # tokenize + Abbreviation lookup
    llm/
      provider.ts             # LlmProvider interface + factory
      ollamaProvider.ts
      anthropicProvider.ts
    routes/
      health.ts
      resolve.ts               # POST /resolve/line, POST /resolve/goal
      abbreviations.ts         # CRUD + confirm-pending
      sessions.ts              # session/set-entry sync endpoints
      goals.ts                 # goal CRUD + weekly volume-vs-target
  tests/
    health.test.ts
    volumeTable.test.ts
    dictionaryResolver.test.ts
    llmProvider.test.ts
    resolve.test.ts
    abbreviations.test.ts
    sessions.test.ts
    goals.test.ts
```

---

### Task 1: Project scaffolding and health check

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/.env.example`
- Create: `backend/vitest.config.ts`
- Create: `backend/src/server.ts`
- Create: `backend/src/routes/health.ts`
- Test: `backend/tests/health.test.ts`

**Interfaces:**
- Produces: `createApp(): express.Express` from `src/server.ts`, used by every later route test to mount the app in-memory via supertest.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "strong-notes-backend",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "prisma:migrate": "prisma migrate dev",
    "prisma:generate": "prisma generate",
    "prisma:seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0",
    "@prisma/client": "^5.20.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^22.7.0",
    "@types/supertest": "^6.0.2",
    "prisma": "^5.20.0",
    "supertest": "^7.0.0",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create .env.example**

```
DATABASE_URL="postgresql://strongnotes:strongnotes@localhost:5432/strongnotes"
API_TOKEN="replace-with-a-long-random-token"
LLM_PROVIDER="ollama"
OLLAMA_URL="http://localhost:11434"
OLLAMA_MODEL="gemma2:2b"
ANTHROPIC_API_KEY=""
PORT="3000"
```

- [ ] **Step 4: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
});
```

- [ ] **Step 5: Write the failing test**

```ts
// backend/tests/health.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server.js';

describe('GET /health', () => {
  it('returns 200 and ok status', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd backend && npm install && npm test`
Expected: FAIL — `src/server.ts` does not exist yet.

- [ ] **Step 7: Implement health route and app factory**

```ts
// backend/src/routes/health.ts
import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});
```

```ts
// backend/src/server.ts
import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(healthRouter);
  return app;
}

if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  const port = process.env.PORT ?? 3000;
  app.listen(port, () => console.log(`strong-notes-api listening on ${port}`));
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add backend/package.json backend/tsconfig.json backend/.env.example backend/vitest.config.ts backend/src/server.ts backend/src/routes/health.ts backend/tests/health.test.ts
git commit -m "feat(backend): scaffold express app with health check"
```

---

### Task 2: Prisma schema and seed data

**Files:**
- Create: `backend/prisma/schema.prisma`
- Create: `backend/prisma/seed.ts`
- Create: `backend/src/db.ts`

**Interfaces:**
- Consumes: none (foundational).
- Produces: Prisma Client models `Exercise`, `MuscleMapEntry`, `Abbreviation`, `WorkoutSession`, `SetEntry`, `Goal`, `GoalTarget`, plus enums `MuscleGroup`, `MuscleRole`, `ExerciseCategory`, `AbbreviationSource`, `ParsedBy`, `GoalType`. Exported Prisma client singleton `prisma` from `src/db.ts`, used by every route task.

- [ ] **Step 1: Write the schema**

```prisma
// backend/prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum MuscleGroup {
  GLUTES
  QUADS
  HAMSTRINGS
  CHEST
  BACK
  SHOULDERS
  ARMS
  CORE
  CALVES
}

enum MuscleRole {
  PRIMARY
  SECONDARY
}

enum ExerciseCategory {
  COMPOUND
  ISOLATION
}

enum AbbreviationSource {
  BUILT_IN
  USER_ADDED
  LLM_SUGGESTED_PENDING_CONFIRM
}

enum ParsedBy {
  DICTIONARY
  LLM
}

enum GoalType {
  HYPERTROPHY
  STRENGTH
  ENDURANCE
  CUSTOM
}

model Exercise {
  id            String           @id @default(cuid())
  name          String           @unique
  category      ExerciseCategory
  muscleMap     MuscleMapEntry[]
  abbreviations Abbreviation[]
  setEntries    SetEntry[]
  createdAt     DateTime         @default(now())
}

model MuscleMapEntry {
  id         String      @id @default(cuid())
  exercise   Exercise    @relation(fields: [exerciseId], references: [id])
  exerciseId String
  muscle     MuscleGroup
  role       MuscleRole
  weight     Float
}

model Abbreviation {
  id            String             @id @default(cuid())
  userId        String             @default("lucas")
  token         String
  exercise      Exercise?          @relation(fields: [exerciseId], references: [id])
  exerciseId    String?
  modifierType  String?
  modifierValue String?
  source        AbbreviationSource @default(USER_ADDED)
  createdAt     DateTime           @default(now())

  @@unique([userId, token])
}

model WorkoutSession {
  id        String     @id @default(cuid())
  userId    String     @default("lucas")
  date      DateTime
  notes     String?
  entries   SetEntry[]
  createdAt DateTime   @default(now())

  @@unique([userId, date])
}

model SetEntry {
  id         String         @id @default(cuid())
  session    WorkoutSession @relation(fields: [sessionId], references: [id])
  sessionId  String
  exercise   Exercise?      @relation(fields: [exerciseId], references: [id])
  exerciseId String?
  equipment  String?
  weightKg   Float?
  reps       Int?
  sets       Int?
  rawText    String
  parsedBy   ParsedBy
  order      Int
  createdAt  DateTime       @default(now())
}

model Goal {
  id          String       @id @default(cuid())
  userId      String       @default("lucas")
  type        GoalType
  description String?
  isActive    Boolean      @default(true)
  targets     GoalTarget[]
  createdAt   DateTime     @default(now())
}

model GoalTarget {
  id             String      @id @default(cuid())
  goal           Goal        @relation(fields: [goalId], references: [id])
  goalId         String
  muscle         MuscleGroup
  minSetsPerWeek Int
  maxSetsPerWeek Int
}
```

- [ ] **Step 2: Create the Prisma client singleton**

```ts
// backend/src/db.ts
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
```

- [ ] **Step 3: Write the seed script (built-in exercises + abbreviations)**

```ts
// backend/prisma/seed.ts
import { PrismaClient, ExerciseCategory, MuscleGroup, MuscleRole, AbbreviationSource } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rdl = await prisma.exercise.upsert({
    where: { name: 'Romanian Deadlift' },
    update: {},
    create: {
      name: 'Romanian Deadlift',
      category: ExerciseCategory.COMPOUND,
      muscleMap: {
        create: [
          { muscle: MuscleGroup.HAMSTRINGS, role: MuscleRole.PRIMARY, weight: 0.7 },
          { muscle: MuscleGroup.GLUTES, role: MuscleRole.SECONDARY, weight: 0.5 },
          { muscle: MuscleGroup.BACK, role: MuscleRole.SECONDARY, weight: 0.3 },
        ],
      },
    },
  });

  const hipThrust = await prisma.exercise.upsert({
    where: { name: 'Hip Thrust' },
    update: {},
    create: {
      name: 'Hip Thrust',
      category: ExerciseCategory.COMPOUND,
      muscleMap: {
        create: [
          { muscle: MuscleGroup.GLUTES, role: MuscleRole.PRIMARY, weight: 0.9 },
          { muscle: MuscleGroup.HAMSTRINGS, role: MuscleRole.SECONDARY, weight: 0.3 },
        ],
      },
    },
  });

  await prisma.abbreviation.upsert({
    where: { userId_token: { userId: 'lucas', token: 'RDL' } },
    update: {},
    create: { userId: 'lucas', token: 'RDL', exerciseId: rdl.id, source: AbbreviationSource.BUILT_IN },
  });

  await prisma.abbreviation.upsert({
    where: { userId_token: { userId: 'lucas', token: 'HT' } },
    update: {},
    create: { userId: 'lucas', token: 'HT', exerciseId: hipThrust.id, source: AbbreviationSource.BUILT_IN },
  });

  await prisma.abbreviation.upsert({
    where: { userId_token: { userId: 'lucas', token: 'BB' } },
    update: {},
    create: { userId: 'lucas', token: 'BB', modifierType: 'equipment', modifierValue: 'barbell', source: AbbreviationSource.BUILT_IN },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 4: Start local Postgres for dev/test**

Run: `docker run --name strong-notes-pg -e POSTGRES_USER=strongnotes -e POSTGRES_PASSWORD=strongnotes -e POSTGRES_DB=strongnotes -p 5432:5432 -d postgres:16`
Expected: container starts; `docker ps` shows `strong-notes-pg` running.

- [ ] **Step 5: Copy env and run the migration**

Run: `cd backend && cp .env.example .env && npx prisma migrate dev --name init`
Expected: migration succeeds, tables created, Prisma Client generated.

- [ ] **Step 6: Run the seed script**

Run: `cd backend && npm run prisma:seed`
Expected: no errors; `npx prisma studio` (optional, manual check) shows 2 exercises, 3 abbreviations.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma backend/src/db.ts
git commit -m "feat(backend): add prisma schema and seed data"
```

---

### Task 3: Auth middleware

**Files:**
- Create: `backend/src/middleware/auth.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/tests/auth.test.ts`

**Interfaces:**
- Consumes: `createApp()` from Task 1.
- Produces: `requireAuth` Express middleware, applied globally in `server.ts` to every route except `/health`. Later route tests must send `Authorization: Bearer test-token` (set via `process.env.API_TOKEN = 'test-token'` in test setup).

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/auth.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server.js';

beforeAll(() => {
  process.env.API_TOKEN = 'test-token';
});

describe('auth middleware', () => {
  it('rejects requests without a bearer token', async () => {
    const app = createApp();
    const res = await request(app).get('/abbreviations');
    expect(res.status).toBe(401);
  });

  it('rejects requests with the wrong token', async () => {
    const app = createApp();
    const res = await request(app).get('/abbreviations').set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  it('allows /health without a token', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — `/abbreviations` route doesn't exist yet (404 instead of 401), proving auth isn't wired.

- [ ] **Step 3: Implement the middleware**

```ts
// backend/src/middleware/auth.ts
import type { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const expected = `Bearer ${process.env.API_TOKEN}`;
  if (!header || header !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}
```

- [ ] **Step 4: Wire it into server.ts (health stays public)**

```ts
// backend/src/server.ts
import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { requireAuth } from './middleware/auth.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(healthRouter);
  app.use(requireAuth);
  // authenticated routers are added by later tasks below this line
  return app;
}

if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  const port = process.env.PORT ?? 3000;
  app.listen(port, () => console.log(`strong-notes-api listening on ${port}`));
}
```

Add a temporary placeholder route in this task so the 401 test has something to hit (removed once Task 8 adds the real `/abbreviations` router — replace this stub in Task 8, don't stack both):

```ts
// backend/src/server.ts (add above the "return app" line, after requireAuth)
app.get('/abbreviations', (_req, res) => res.status(200).json([]));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/middleware/auth.ts backend/src/server.ts backend/tests/auth.test.ts
git commit -m "feat(backend): add bearer token auth middleware"
```

---

### Task 4: Muscle taxonomy and static volume science table

**Files:**
- Create: `backend/src/science/muscleGroups.ts`
- Create: `backend/src/science/volumeTable.ts`
- Test: `backend/tests/volumeTable.test.ts`

**Interfaces:**
- Consumes: `MuscleGroup` enum from Prisma Client (Task 2).
- Produces: `MUSCLE_GROUPS: { value: MuscleGroup; label: string }[]` and `getVolumeTargets(goalType: GoalType): Record<MuscleGroup, { min: number; max: number }>`, used by the Goals route (Task 9) to default new goal targets.

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/volumeTable.test.ts
import { describe, it, expect } from 'vitest';
import { GoalType, MuscleGroup } from '@prisma/client';
import { getVolumeTargets } from '../src/science/volumeTable.js';

describe('getVolumeTargets', () => {
  it('returns hypertrophy ranges for glutes', () => {
    const targets = getVolumeTargets(GoalType.HYPERTROPHY);
    expect(targets[MuscleGroup.GLUTES]).toEqual({ min: 12, max: 20 });
  });

  it('returns strength ranges that are lower volume than hypertrophy', () => {
    const strength = getVolumeTargets(GoalType.STRENGTH);
    const hypertrophy = getVolumeTargets(GoalType.HYPERTROPHY);
    expect(strength[MuscleGroup.QUADS].max).toBeLessThan(hypertrophy[MuscleGroup.QUADS].max);
  });

  it('covers every muscle group for every goal type', () => {
    for (const goalType of Object.values(GoalType)) {
      const targets = getVolumeTargets(goalType);
      for (const muscle of Object.values(MuscleGroup)) {
        expect(targets[muscle]).toBeDefined();
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — `src/science/volumeTable.ts` does not exist.

- [ ] **Step 3: Implement the muscle taxonomy**

```ts
// backend/src/science/muscleGroups.ts
import { MuscleGroup } from '@prisma/client';

export const MUSCLE_GROUPS: { value: MuscleGroup; label: string }[] = [
  { value: MuscleGroup.GLUTES, label: 'Glutes' },
  { value: MuscleGroup.QUADS, label: 'Quads' },
  { value: MuscleGroup.HAMSTRINGS, label: 'Hamstrings' },
  { value: MuscleGroup.CHEST, label: 'Chest' },
  { value: MuscleGroup.BACK, label: 'Back' },
  { value: MuscleGroup.SHOULDERS, label: 'Shoulders' },
  { value: MuscleGroup.ARMS, label: 'Arms' },
  { value: MuscleGroup.CORE, label: 'Core' },
  { value: MuscleGroup.CALVES, label: 'Calves' },
];
```

- [ ] **Step 4: Implement the volume table**

```ts
// backend/src/science/volumeTable.ts
import { GoalType, MuscleGroup } from '@prisma/client';

type Range = { min: number; max: number };
type MuscleRanges = Record<MuscleGroup, Range>;

const HYPERTROPHY: MuscleRanges = {
  GLUTES: { min: 12, max: 20 },
  QUADS: { min: 10, max: 18 },
  HAMSTRINGS: { min: 8, max: 16 },
  CHEST: { min: 10, max: 18 },
  BACK: { min: 10, max: 16 },
  SHOULDERS: { min: 8, max: 16 },
  ARMS: { min: 6, max: 14 },
  CORE: { min: 6, max: 12 },
  CALVES: { min: 8, max: 16 },
};

const STRENGTH: MuscleRanges = {
  GLUTES: { min: 4, max: 8 },
  QUADS: { min: 4, max: 8 },
  HAMSTRINGS: { min: 3, max: 6 },
  CHEST: { min: 3, max: 6 },
  BACK: { min: 4, max: 8 },
  SHOULDERS: { min: 3, max: 6 },
  ARMS: { min: 2, max: 5 },
  CORE: { min: 3, max: 6 },
  CALVES: { min: 3, max: 6 },
};

const ENDURANCE: MuscleRanges = {
  GLUTES: { min: 8, max: 14 },
  QUADS: { min: 8, max: 14 },
  HAMSTRINGS: { min: 6, max: 12 },
  CHEST: { min: 6, max: 12 },
  BACK: { min: 6, max: 12 },
  SHOULDERS: { min: 6, max: 12 },
  ARMS: { min: 5, max: 10 },
  CORE: { min: 8, max: 14 },
  CALVES: { min: 8, max: 14 },
};

// CUSTOM starts from hypertrophy defaults; the user overrides per-muscle via the Goals route.
const CUSTOM: MuscleRanges = HYPERTROPHY;

const TABLE: Record<GoalType, MuscleRanges> = {
  HYPERTROPHY,
  STRENGTH,
  ENDURANCE,
  CUSTOM,
};

export function getVolumeTargets(goalType: GoalType): MuscleRanges {
  return TABLE[goalType];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/science
git commit -m "feat(backend): add muscle taxonomy and static volume science table"
```

---

### Task 5: Dictionary resolver

**Files:**
- Create: `backend/src/parsing/dictionaryResolver.ts`
- Test: `backend/tests/dictionaryResolver.test.ts`

**Interfaces:**
- Consumes: `prisma` from `src/db.ts` (Task 2), `Abbreviation`/`Exercise` models.
- Produces: `resolveLineWithDictionary(line: string, userId: string): Promise<DictionaryResolution>` where
  ```ts
  type DictionaryResolution = {
    resolvedTokens: { token: string; type: 'exercise' | 'modifier'; exerciseId?: string; modifierType?: string; modifierValue?: string }[];
    unresolvedTokens: string[];
  };
  ```
  Used by the `/resolve/line` route (Task 7) to decide whether the LLM fallback is needed.

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/dictionaryResolver.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/db.js';
import { resolveLineWithDictionary } from '../src/parsing/dictionaryResolver.js';
import { ExerciseCategory, AbbreviationSource } from '@prisma/client';

beforeAll(async () => {
  const exercise = await prisma.exercise.create({
    data: { name: 'Test Squat', category: ExerciseCategory.COMPOUND },
  });
  await prisma.abbreviation.create({
    data: { userId: 'lucas', token: 'TSQ', exerciseId: exercise.id, source: AbbreviationSource.USER_ADDED },
  });
  await prisma.abbreviation.create({
    data: { userId: 'lucas', token: 'BB', modifierType: 'equipment', modifierValue: 'barbell', source: AbbreviationSource.BUILT_IN },
  });
});

afterAll(async () => {
  await prisma.abbreviation.deleteMany({ where: { token: { in: ['TSQ', 'BB'] } } });
  await prisma.exercise.deleteMany({ where: { name: 'Test Squat' } });
  await prisma.$disconnect();
});

describe('resolveLineWithDictionary', () => {
  it('resolves known tokens and flags unknown ones', async () => {
    const result = await resolveLineWithDictionary('TSQ BB 40kg 8x3 WXYZ', 'lucas');
    expect(result.resolvedTokens.map((t) => t.token)).toEqual(['TSQ', 'BB']);
    expect(result.unresolvedTokens).toContain('WXYZ');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — `src/parsing/dictionaryResolver.ts` does not exist.

- [ ] **Step 3: Implement the resolver**

Numeric tokens (weight like `40kg`, rep/set patterns like `8x3`) are always left unresolved by the dictionary layer — they're handled by numeric parsing in the `/resolve/line` route (Task 7), not by dictionary lookup.

```ts
// backend/src/parsing/dictionaryResolver.ts
import { prisma } from '../db.js';

export type DictionaryResolution = {
  resolvedTokens: {
    token: string;
    type: 'exercise' | 'modifier';
    exerciseId?: string;
    modifierType?: string;
    modifierValue?: string;
  }[];
  unresolvedTokens: string[];
};

const NUMERIC_TOKEN = /^\d+(\.\d+)?(kg|lb)?$|^\d+x\d+$/i;

export async function resolveLineWithDictionary(line: string, userId: string): Promise<DictionaryResolution> {
  const tokens = line.trim().split(/\s+/);
  const wordTokens = tokens.filter((t) => !NUMERIC_TOKEN.test(t));

  const abbreviations = await prisma.abbreviation.findMany({
    where: { userId, token: { in: wordTokens.map((t) => t.toUpperCase()) } },
  });
  const byToken = new Map(abbreviations.map((a) => [a.token, a]));

  const resolvedTokens: DictionaryResolution['resolvedTokens'] = [];
  const unresolvedTokens: string[] = [];

  for (const token of wordTokens) {
    const match = byToken.get(token.toUpperCase());
    if (!match) {
      unresolvedTokens.push(token);
      continue;
    }
    if (match.exerciseId) {
      resolvedTokens.push({ token, type: 'exercise', exerciseId: match.exerciseId });
    } else {
      resolvedTokens.push({
        token,
        type: 'modifier',
        modifierType: match.modifierType ?? undefined,
        modifierValue: match.modifierValue ?? undefined,
      });
    }
  }

  return { resolvedTokens, unresolvedTokens };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/parsing backend/tests/dictionaryResolver.test.ts
git commit -m "feat(backend): add dictionary-based shorthand resolver"
```

---

### Task 6: LLM provider abstraction (Ollama + Anthropic)

**Files:**
- Create: `backend/src/llm/provider.ts`
- Create: `backend/src/llm/ollamaProvider.ts`
- Create: `backend/src/llm/anthropicProvider.ts`
- Test: `backend/tests/llmProvider.test.ts`

**Interfaces:**
- Consumes: `OLLAMA_URL`, `OLLAMA_MODEL`, `ANTHROPIC_API_KEY`, `LLM_PROVIDER` env vars.
- Produces:
  ```ts
  export type LineGuess = { exerciseName: string; equipment?: string; weightKg?: number; reps?: number; sets?: number };
  export type GoalGuess = { type: 'HYPERTROPHY' | 'STRENGTH' | 'ENDURANCE' | 'CUSTOM'; muscles: string[] };
  export interface LlmProvider {
    resolveLine(line: string, unresolvedTokens: string[]): Promise<LineGuess>;
    resolveGoal(text: string): Promise<GoalGuess>;
  }
  export function getLlmProvider(): LlmProvider;
  ```
  Used by the `/resolve/line` and `/resolve/goal` routes (Task 7).

- [ ] **Step 1: Write the failing test (factory selection only — provider internals are exercised via the route tests in Task 7 using a fake)**

```ts
// backend/tests/llmProvider.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getLlmProvider } from '../src/llm/provider.js';
import { OllamaProvider } from '../src/llm/ollamaProvider.js';
import { AnthropicProvider } from '../src/llm/anthropicProvider.js';

describe('getLlmProvider', () => {
  beforeEach(() => {
    delete process.env.LLM_PROVIDER;
  });

  it('returns OllamaProvider when LLM_PROVIDER=ollama', () => {
    process.env.LLM_PROVIDER = 'ollama';
    expect(getLlmProvider()).toBeInstanceOf(OllamaProvider);
  });

  it('returns AnthropicProvider when LLM_PROVIDER=anthropic', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    expect(getLlmProvider()).toBeInstanceOf(AnthropicProvider);
  });

  it('throws on an unknown provider value', () => {
    process.env.LLM_PROVIDER = 'bogus';
    expect(() => getLlmProvider()).toThrow(/unknown LLM_PROVIDER/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — none of the provider files exist.

- [ ] **Step 3: Define the shared interface**

```ts
// backend/src/llm/provider.ts
export type LineGuess = {
  exerciseName: string;
  equipment?: string;
  weightKg?: number;
  reps?: number;
  sets?: number;
};

export type GoalGuess = {
  type: 'HYPERTROPHY' | 'STRENGTH' | 'ENDURANCE' | 'CUSTOM';
  muscles: string[];
};

export interface LlmProvider {
  resolveLine(line: string, unresolvedTokens: string[]): Promise<LineGuess>;
  resolveGoal(text: string): Promise<GoalGuess>;
}

export function getLlmProvider(): LlmProvider {
  const provider = process.env.LLM_PROVIDER;
  if (provider === 'ollama') {
    return new (require('./ollamaProvider.js').OllamaProvider)();
  }
  if (provider === 'anthropic') {
    return new (require('./anthropicProvider.js').AnthropicProvider)();
  }
  throw new Error(`unknown LLM_PROVIDER: ${provider}`);
}
```

Note: this file uses `require` for lazy loading so importing `provider.ts` alone (as the factory test does) never requires `ANTHROPIC_API_KEY` to be set. Since the project is ESM (`"type": "module"`), enable synthetic CJS interop by importing `createRequire`:

```ts
// backend/src/llm/provider.ts (replace the require calls above with this at the top of the file)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
```

- [ ] **Step 4: Implement the Ollama provider**

```ts
// backend/src/llm/ollamaProvider.ts
import type { LlmProvider, LineGuess, GoalGuess } from './provider.js';

const LINE_PROMPT = (line: string, unresolved: string[]) => `You are a gym-log parser. Given this logged line: "${line}"
The unrecognized tokens are: ${unresolved.join(', ')}.
Respond ONLY with JSON: {"exerciseName": string, "equipment": string|null, "weightKg": number|null, "reps": number|null, "sets": number|null}`;

const GOAL_PROMPT = (text: string) => `You are a fitness goal classifier. Given this goal description: "${text}"
Respond ONLY with JSON: {"type": "HYPERTROPHY"|"STRENGTH"|"ENDURANCE"|"CUSTOM", "muscles": string[]} where muscles are from
["GLUTES","QUADS","HAMSTRINGS","CHEST","BACK","SHOULDERS","ARMS","CORE","CALVES"].`;

export class OllamaProvider implements LlmProvider {
  private baseUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434';
  private model = process.env.OLLAMA_MODEL ?? 'gemma2:2b';

  private async generate(prompt: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, stream: false, format: 'json' }),
    });
    if (!res.ok) throw new Error(`ollama request failed: ${res.status}`);
    const data = (await res.json()) as { response: string };
    return data.response;
  }

  async resolveLine(line: string, unresolvedTokens: string[]): Promise<LineGuess> {
    const raw = await this.generate(LINE_PROMPT(line, unresolvedTokens));
    return JSON.parse(raw) as LineGuess;
  }

  async resolveGoal(text: string): Promise<GoalGuess> {
    const raw = await this.generate(GOAL_PROMPT(text));
    return JSON.parse(raw) as GoalGuess;
  }
}
```

- [ ] **Step 5: Implement the Anthropic provider**

```ts
// backend/src/llm/anthropicProvider.ts
import Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider, LineGuess, GoalGuess } from './provider.js';

const LINE_PROMPT = (line: string, unresolved: string[]) => `You are a gym-log parser. Given this logged line: "${line}"
The unrecognized tokens are: ${unresolved.join(', ')}.
Respond ONLY with JSON: {"exerciseName": string, "equipment": string|null, "weightKg": number|null, "reps": number|null, "sets": number|null}`;

const GOAL_PROMPT = (text: string) => `You are a fitness goal classifier. Given this goal description: "${text}"
Respond ONLY with JSON: {"type": "HYPERTROPHY"|"STRENGTH"|"ENDURANCE"|"CUSTOM", "muscles": string[]} where muscles are from
["GLUTES","QUADS","HAMSTRINGS","CHEST","BACK","SHOULDERS","ARMS","CORE","CALVES"].`;

export class AnthropicProvider implements LlmProvider {
  private client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  private model = 'claude-haiku-4-5-20251001';

  private async ask(prompt: string): Promise<string> {
    const msg = await this.client.messages.create({
      model: this.model,
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = msg.content[0];
    if (block.type !== 'text') throw new Error('unexpected non-text response from Anthropic');
    return block.text;
  }

  async resolveLine(line: string, unresolvedTokens: string[]): Promise<LineGuess> {
    const raw = await this.ask(LINE_PROMPT(line, unresolvedTokens));
    return JSON.parse(raw) as LineGuess;
  }

  async resolveGoal(text: string): Promise<GoalGuess> {
    const raw = await this.ask(GOAL_PROMPT(text));
    return JSON.parse(raw) as GoalGuess;
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS (the factory test only checks `instanceof`, so it never actually calls the network — no live Ollama/Anthropic needed to pass this task's test).

- [ ] **Step 7: Commit**

```bash
git add backend/src/llm
git commit -m "feat(backend): add swappable LLM provider (ollama/anthropic)"
```

---

### Task 7: /resolve/line and /resolve/goal routes

**Files:**
- Create: `backend/src/routes/resolve.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/tests/resolve.test.ts`

**Interfaces:**
- Consumes: `resolveLineWithDictionary` (Task 5), `getLlmProvider`/`LlmProvider` (Task 6), `prisma` (Task 2).
- Produces: `resolveRouter` mounted at root, exposing:
  - `POST /resolve/line` body `{ line: string }` → `{ resolvedTokens, unresolvedTokens, llmGuess?: LineGuess }`
  - `POST /resolve/goal` body `{ text: string }` → `GoalGuess`
  Used directly by the mobile app; no later backend task depends on this one internally.

- [ ] **Step 1: Write the failing test (LLM provider mocked via dependency injection)**

```ts
// backend/tests/resolve.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server.js';
import * as llm from '../src/llm/provider.js';

beforeAll(() => {
  process.env.API_TOKEN = 'test-token';
});

describe('POST /resolve/line', () => {
  it('returns dictionary-only result when all tokens resolve', async () => {
    vi.spyOn(llm, 'getLlmProvider').mockReturnValue({
      resolveLine: vi.fn(),
      resolveGoal: vi.fn(),
    });
    const app = createApp();
    const res = await request(app)
      .post('/resolve/line')
      .set('Authorization', 'Bearer test-token')
      .send({ line: 'BB 40kg 8x3' });
    expect(res.status).toBe(200);
    expect(res.body.unresolvedTokens).toEqual([]);
    expect(res.body.llmGuess).toBeUndefined();
  });

  it('falls back to the LLM for unresolved tokens', async () => {
    vi.spyOn(llm, 'getLlmProvider').mockReturnValue({
      resolveLine: vi.fn().mockResolvedValue({ exerciseName: 'Cable Crab Walk', equipment: null, weightKg: null, reps: 8, sets: 2 }),
      resolveGoal: vi.fn(),
    });
    const app = createApp();
    const res = await request(app)
      .post('/resolve/line')
      .set('Authorization', 'Bearer test-token')
      .send({ line: 'CRABWALK 8x2' });
    expect(res.status).toBe(200);
    expect(res.body.llmGuess.exerciseName).toBe('Cable Crab Walk');
  });
});

describe('POST /resolve/goal', () => {
  it('translates free text into a structured goal guess', async () => {
    vi.spyOn(llm, 'getLlmProvider').mockReturnValue({
      resolveLine: vi.fn(),
      resolveGoal: vi.fn().mockResolvedValue({ type: 'HYPERTROPHY', muscles: ['GLUTES', 'HAMSTRINGS'] }),
    });
    const app = createApp();
    const res = await request(app)
      .post('/resolve/goal')
      .set('Authorization', 'Bearer test-token')
      .send({ text: 'I want a bigger booty' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: 'HYPERTROPHY', muscles: ['GLUTES', 'HAMSTRINGS'] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — `/resolve/line` and `/resolve/goal` don't exist (404).

- [ ] **Step 3: Implement the route**

```ts
// backend/src/routes/resolve.ts
import { Router } from 'express';
import { z } from 'zod';
import { resolveLineWithDictionary } from '../parsing/dictionaryResolver.js';
import { getLlmProvider } from '../llm/provider.js';

export const resolveRouter = Router();

const lineSchema = z.object({ line: z.string().min(1) });
const goalSchema = z.object({ text: z.string().min(1) });

resolveRouter.post('/resolve/line', async (req, res) => {
  const parsed = lineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const dictionaryResult = await resolveLineWithDictionary(parsed.data.line, 'lucas');
  if (dictionaryResult.unresolvedTokens.length === 0) {
    return res.status(200).json(dictionaryResult);
  }

  const llmGuess = await getLlmProvider().resolveLine(parsed.data.line, dictionaryResult.unresolvedTokens);
  return res.status(200).json({ ...dictionaryResult, llmGuess });
});

resolveRouter.post('/resolve/goal', async (req, res) => {
  const parsed = goalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const guess = await getLlmProvider().resolveGoal(parsed.data.text);
  return res.status(200).json(guess);
});
```

- [ ] **Step 4: Mount the router in server.ts**

```ts
// backend/src/server.ts (add import and app.use, replacing nothing else)
import { resolveRouter } from './routes/resolve.js';
// ... inside createApp(), after app.use(requireAuth):
app.use(resolveRouter);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/resolve.ts backend/src/server.ts backend/tests/resolve.test.ts
git commit -m "feat(backend): add /resolve/line and /resolve/goal routes"
```

---

### Task 8: Abbreviations CRUD + confirm-pending route

**Files:**
- Create: `backend/src/routes/abbreviations.ts`
- Modify: `backend/src/server.ts` (remove the Task 3 placeholder, mount the real router)
- Test: `backend/tests/abbreviations.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2).
- Produces:
  - `GET /abbreviations` → list for `userId=lucas`
  - `POST /abbreviations` body `{ token, exerciseId?, modifierType?, modifierValue? }` → create with `source: USER_ADDED`
  - `PATCH /abbreviations/:id/confirm` → flips `source` from `LLM_SUGGESTED_PENDING_CONFIRM` to `USER_ADDED`
  Used by the mobile app's dictionary-save-on-confirm flow described in the spec.

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/abbreviations.test.ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server.js';
import { prisma } from '../src/db.js';
import { AbbreviationSource } from '@prisma/client';

beforeAll(() => {
  process.env.API_TOKEN = 'test-token';
});

afterEach(async () => {
  await prisma.abbreviation.deleteMany({ where: { token: { startsWith: 'ZZ' } } });
});

describe('/abbreviations', () => {
  it('creates and lists a user-added abbreviation', async () => {
    const app = createApp();
    const auth = { Authorization: 'Bearer test-token' };

    const createRes = await request(app).post('/abbreviations').set(auth).send({
      token: 'ZZTEST',
      modifierType: 'equipment',
      modifierValue: 'kettlebell',
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.source).toBe('USER_ADDED');

    const listRes = await request(app).get('/abbreviations').set(auth);
    expect(listRes.body.some((a: { token: string }) => a.token === 'ZZTEST')).toBe(true);
  });

  it('confirms a pending llm-suggested abbreviation', async () => {
    const pending = await prisma.abbreviation.create({
      data: { userId: 'lucas', token: 'ZZPEND', modifierType: 'equipment', modifierValue: 'sled', source: AbbreviationSource.LLM_SUGGESTED_PENDING_CONFIRM },
    });
    const app = createApp();
    const res = await request(app)
      .patch(`/abbreviations/${pending.id}/confirm`)
      .set('Authorization', 'Bearer test-token');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('USER_ADDED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — real `/abbreviations` router doesn't exist (Task 3's stub always returns `[]` and has no POST/PATCH).

- [ ] **Step 3: Implement the router**

```ts
// backend/src/routes/abbreviations.ts
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { AbbreviationSource } from '@prisma/client';

export const abbreviationsRouter = Router();

const createSchema = z.object({
  token: z.string().min(1),
  exerciseId: z.string().optional(),
  modifierType: z.string().optional(),
  modifierValue: z.string().optional(),
});

abbreviationsRouter.get('/abbreviations', async (_req, res) => {
  const list = await prisma.abbreviation.findMany({ where: { userId: 'lucas' } });
  res.status(200).json(list);
});

abbreviationsRouter.post('/abbreviations', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const created = await prisma.abbreviation.create({
    data: { userId: 'lucas', source: AbbreviationSource.USER_ADDED, ...parsed.data },
  });
  res.status(201).json(created);
});

abbreviationsRouter.patch('/abbreviations/:id/confirm', async (req, res) => {
  const updated = await prisma.abbreviation.update({
    where: { id: req.params.id },
    data: { source: AbbreviationSource.USER_ADDED },
  });
  res.status(200).json(updated);
});
```

- [ ] **Step 4: Replace the Task 3 placeholder in server.ts**

```ts
// backend/src/server.ts
// Remove: app.get('/abbreviations', (_req, res) => res.status(200).json([]));
// Add import: import { abbreviationsRouter } from './routes/abbreviations.js';
// Add, after app.use(resolveRouter): app.use(abbreviationsRouter);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/abbreviations.ts backend/src/server.ts backend/tests/abbreviations.test.ts
git commit -m "feat(backend): add abbreviations CRUD and confirm-pending route"
```

---

### Task 9: Sessions and set-entry sync routes

**Files:**
- Create: `backend/src/routes/sessions.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/tests/sessions.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2).
- Produces:
  - `GET /sessions?from=&to=` → sessions with entries, filtered by date range, for `userId=lucas`
  - `PUT /sessions/:date` (date as `YYYY-MM-DD`) body `{ notes?, entries: SetEntryInput[] }` → upserts the session and replaces its entries (idempotent sync target for the mobile app's background push)
  where `SetEntryInput = { exerciseId?, equipment?, weightKg?, reps?, sets?, rawText, parsedBy, order }`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/sessions.test.ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server.js';
import { prisma } from '../src/db.js';

beforeAll(() => {
  process.env.API_TOKEN = 'test-token';
});

afterEach(async () => {
  await prisma.workoutSession.deleteMany({ where: { date: new Date('2026-07-01T00:00:00.000Z') } });
});

describe('/sessions', () => {
  it('upserts a session with entries and lists it back', async () => {
    const app = createApp();
    const auth = { Authorization: 'Bearer test-token' };

    const putRes = await request(app)
      .put('/sessions/2026-07-01')
      .set(auth)
      .send({
        notes: 'leg day',
        entries: [
          { rawText: 'BB RDL 40kg 8x3', parsedBy: 'DICTIONARY', order: 0 },
        ],
      });
    expect(putRes.status).toBe(200);
    expect(putRes.body.entries).toHaveLength(1);

    const listRes = await request(app)
      .get('/sessions?from=2026-07-01&to=2026-07-01')
      .set(auth);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].notes).toBe('leg day');
  });

  it('replaces entries on repeat sync of the same date', async () => {
    const app = createApp();
    const auth = { Authorization: 'Bearer test-token' };

    await request(app).put('/sessions/2026-07-01').set(auth).send({
      entries: [{ rawText: 'first', parsedBy: 'DICTIONARY', order: 0 }],
    });
    const secondPut = await request(app).put('/sessions/2026-07-01').set(auth).send({
      entries: [{ rawText: 'second', parsedBy: 'DICTIONARY', order: 0 }],
    });
    expect(secondPut.body.entries).toHaveLength(1);
    expect(secondPut.body.entries[0].rawText).toBe('second');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — `/sessions` routes don't exist.

- [ ] **Step 3: Implement the router**

```ts
// backend/src/routes/sessions.ts
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ParsedBy } from '@prisma/client';

export const sessionsRouter = Router();

const entrySchema = z.object({
  exerciseId: z.string().optional(),
  equipment: z.string().optional(),
  weightKg: z.number().optional(),
  reps: z.number().int().optional(),
  sets: z.number().int().optional(),
  rawText: z.string().min(1),
  parsedBy: z.nativeEnum(ParsedBy),
  order: z.number().int(),
});

const putSchema = z.object({
  notes: z.string().optional(),
  entries: z.array(entrySchema),
});

sessionsRouter.get('/sessions', async (req, res) => {
  const from = new Date(String(req.query.from));
  const to = new Date(String(req.query.to));
  const sessions = await prisma.workoutSession.findMany({
    where: { userId: 'lucas', date: { gte: from, lte: to } },
    include: { entries: true },
    orderBy: { date: 'asc' },
  });
  res.status(200).json(sessions);
});

sessionsRouter.put('/sessions/:date', async (req, res) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const date = new Date(`${req.params.date}T00:00:00.000Z`);

  const session = await prisma.$transaction(async (tx) => {
    const existing = await tx.workoutSession.upsert({
      where: { userId_date: { userId: 'lucas', date } },
      update: { notes: parsed.data.notes },
      create: { userId: 'lucas', date, notes: parsed.data.notes },
    });
    await tx.setEntry.deleteMany({ where: { sessionId: existing.id } });
    await tx.setEntry.createMany({
      data: parsed.data.entries.map((e) => ({ ...e, sessionId: existing.id })),
    });
    return tx.workoutSession.findUniqueOrThrow({
      where: { id: existing.id },
      include: { entries: true },
    });
  });

  res.status(200).json(session);
});
```

- [ ] **Step 4: Mount the router in server.ts**

```ts
// backend/src/server.ts (add import and app.use, after abbreviationsRouter)
import { sessionsRouter } from './routes/sessions.js';
// ...
app.use(sessionsRouter);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/sessions.ts backend/src/server.ts backend/tests/sessions.test.ts
git commit -m "feat(backend): add sessions sync routes with entry replace-on-upsert"
```

---

### Task 10: Goals routes with weekly volume-vs-target computation

**Files:**
- Create: `backend/src/routes/goals.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/tests/goals.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2), `getVolumeTargets` (Task 4).
- Produces:
  - `POST /goals` body `{ type: GoalType, description?, overrides?: { muscle: MuscleGroup; min: number; max: number }[] }` → deactivates prior active goal, creates a new active one defaulted from `getVolumeTargets`, applying any overrides
  - `GET /goals/active` → active goal with targets
  - `GET /goals/active/progress?weekStart=YYYY-MM-DD` → per-muscle `{ muscle, targetMin, targetMax, actualSets }` by summing `SetEntry.sets` through each entry's `Exercise.muscleMap` for sessions in that week — this is the data source for the mobile app's muscle heatmap.

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/goals.test.ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server.js';
import { prisma } from '../src/db.js';
import { ExerciseCategory, MuscleGroup, MuscleRole, ParsedBy } from '@prisma/client';

beforeAll(() => {
  process.env.API_TOKEN = 'test-token';
});

afterEach(async () => {
  await prisma.goal.deleteMany({ where: { userId: 'lucas' } });
  await prisma.workoutSession.deleteMany({ where: { date: new Date('2026-07-06T00:00:00.000Z') } });
  await prisma.exercise.deleteMany({ where: { name: 'Test Hip Thrust' } });
});

describe('/goals', () => {
  it('creates an active hypertrophy goal with default glute targets', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/goals')
      .set('Authorization', 'Bearer test-token')
      .send({ type: 'HYPERTROPHY' });
    expect(res.status).toBe(201);
    const glutes = res.body.targets.find((t: { muscle: string }) => t.muscle === 'GLUTES');
    expect(glutes).toEqual(expect.objectContaining({ muscle: 'GLUTES', minSetsPerWeek: 12, maxSetsPerWeek: 20 }));
  });

  it('computes actual sets vs target for the active goal', async () => {
    const app = createApp();
    const auth = { Authorization: 'Bearer test-token' };
    await request(app).post('/goals').set(auth).send({ type: 'HYPERTROPHY' });

    const exercise = await prisma.exercise.create({
      data: {
        name: 'Test Hip Thrust',
        category: ExerciseCategory.COMPOUND,
        muscleMap: { create: [{ muscle: MuscleGroup.GLUTES, role: MuscleRole.PRIMARY, weight: 1 }] },
      },
    });
    await prisma.workoutSession.create({
      data: {
        userId: 'lucas',
        date: new Date('2026-07-06T00:00:00.000Z'),
        entries: { create: [{ exerciseId: exercise.id, sets: 4, rawText: 'HT 40kg 8x4', parsedBy: ParsedBy.DICTIONARY, order: 0 }] },
      },
    });

    const res = await request(app).get('/goals/active/progress?weekStart=2026-07-06').set(auth);
    expect(res.status).toBe(200);
    const glutes = res.body.find((p: { muscle: string }) => p.muscle === 'GLUTES');
    expect(glutes.actualSets).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — `/goals` routes don't exist.

- [ ] **Step 3: Implement the router**

```ts
// backend/src/routes/goals.ts
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { GoalType, MuscleGroup } from '@prisma/client';
import { getVolumeTargets } from '../science/volumeTable.js';

export const goalsRouter = Router();

const createSchema = z.object({
  type: z.nativeEnum(GoalType),
  description: z.string().optional(),
  overrides: z
    .array(z.object({ muscle: z.nativeEnum(MuscleGroup), min: z.number().int(), max: z.number().int() }))
    .optional(),
});

goalsRouter.post('/goals', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const defaults = getVolumeTargets(parsed.data.type);
  const overridesByMuscle = new Map((parsed.data.overrides ?? []).map((o) => [o.muscle, o]));

  const goal = await prisma.$transaction(async (tx) => {
    await tx.goal.updateMany({ where: { userId: 'lucas', isActive: true }, data: { isActive: false } });
    return tx.goal.create({
      data: {
        userId: 'lucas',
        type: parsed.data.type,
        description: parsed.data.description,
        isActive: true,
        targets: {
          create: Object.values(MuscleGroup).map((muscle) => {
            const override = overridesByMuscle.get(muscle);
            const range = override ?? defaults[muscle];
            return {
              muscle,
              minSetsPerWeek: override ? override.min : range.min,
              maxSetsPerWeek: override ? override.max : range.max,
            };
          }),
        },
      },
      include: { targets: true },
    });
  });

  res.status(201).json(goal);
});

goalsRouter.get('/goals/active', async (_req, res) => {
  const goal = await prisma.goal.findFirst({ where: { userId: 'lucas', isActive: true }, include: { targets: true } });
  if (!goal) return res.status(404).json({ error: 'no active goal' });
  res.status(200).json(goal);
});

goalsRouter.get('/goals/active/progress', async (req, res) => {
  const goal = await prisma.goal.findFirst({ where: { userId: 'lucas', isActive: true }, include: { targets: true } });
  if (!goal) return res.status(404).json({ error: 'no active goal' });

  const weekStart = new Date(`${String(req.query.weekStart)}T00:00:00.000Z`);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const sessions = await prisma.workoutSession.findMany({
    where: { userId: 'lucas', date: { gte: weekStart, lt: weekEnd } },
    include: { entries: { include: { exercise: { include: { muscleMap: true } } } } },
  });

  const actualByMuscle = new Map<MuscleGroup, number>();
  for (const session of sessions) {
    for (const entry of session.entries) {
      if (!entry.exercise || !entry.sets) continue;
      for (const mapping of entry.exercise.muscleMap) {
        actualByMuscle.set(mapping.muscle, (actualByMuscle.get(mapping.muscle) ?? 0) + entry.sets);
      }
    }
  }

  const progress = goal.targets.map((target) => ({
    muscle: target.muscle,
    targetMin: target.minSetsPerWeek,
    targetMax: target.maxSetsPerWeek,
    actualSets: actualByMuscle.get(target.muscle) ?? 0,
  }));

  res.status(200).json(progress);
});
```

- [ ] **Step 4: Mount the router in server.ts**

```ts
// backend/src/server.ts (add import and app.use, after sessionsRouter)
import { goalsRouter } from './routes/goals.js';
// ...
app.use(goalsRouter);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/goals.ts backend/src/server.ts backend/tests/goals.test.ts
git commit -m "feat(backend): add goals routes with weekly volume-vs-target progress"
```

---

### Task 11: Dockerfile, docker-compose, and Proxmox deployment

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/docker-compose.yml` (reference copy; the deployed one lives on the Proxmox host per the homelab convention)
- Create: `backend/DEPLOY.md`

**Interfaces:**
- Consumes: none (ops task, no code interfaces).
- Produces: a running `strong-notes-api` + `postgres` stack reachable at `https://strong-notes-api.lurkhuset.com`, which the mobile app plan will target as its API base URL.

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# backend/Dockerfile
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npx prisma generate && npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

- [ ] **Step 2: Write the reference docker-compose.yml**

```yaml
# backend/docker-compose.yml
services:
  api:
    build: .
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://strongnotes:${POSTGRES_PASSWORD}@postgres:5432/strongnotes
      API_TOKEN: ${API_TOKEN}
      LLM_PROVIDER: anthropic
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    networks: [caddy-net]
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: strongnotes
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: strongnotes
    volumes:
      - /tank/apps/strong-notes/pgdata:/var/lib/postgresql/data
    networks: [caddy-net]

networks:
  caddy-net:
    external: true
```

- [ ] **Step 3: Write DEPLOY.md documenting the Proxmox rollout**

```markdown
# Deploying strong-notes-api to Proxmox

Following the standard "add a new Docker service" recipe:

1. `ssh proxmox`
2. `sudo zfs create tank/apps/strong-notes` then `sudo chown -R 999:999 /tank/apps/strong-notes` (postgres UID)
3. `mkdir -p /opt/stacks/strong-notes-api` and copy this directory's `docker-compose.yml`, `Dockerfile`, and source there (or `git clone` this repo on the host)
4. Create `/opt/stacks/strong-notes-api/.env` with `POSTGRES_PASSWORD`, `API_TOKEN` (long random value), `ANTHROPIC_API_KEY`
5. `cd /opt/stacks/strong-notes-api && sudo docker compose up -d --build`
6. Run migrations once: `sudo docker compose exec api npx prisma migrate deploy`
7. Run the seed once: `sudo docker compose exec api npm run prisma:seed`
8. Append to `/opt/stacks/caddy/Caddyfile`:
   ```
   strong-notes-api.lurkhuset.com {
       reverse_proxy api:3000
   }
   ```
9. `sudo docker exec caddy-caddy-1 caddy reload --config /etc/caddy/Caddyfile`
10. Verify: `curl -fsS https://strong-notes-api.lurkhuset.com/health` returns `{"status":"ok"}`
11. Add an Uptime Kuma HTTP monitor for `https://strong-notes-api.lurkhuset.com/health`.

This stack is public via the existing Cloudflare Tunnel wildcard ingress, so no tunnel config change is needed.
```

- [ ] **Step 4: Verify the full local test suite still passes before deploying**

Run: `cd backend && npm test`
Expected: PASS (all tasks' tests green)

- [ ] **Step 5: Commit**

```bash
git add backend/Dockerfile backend/docker-compose.yml backend/DEPLOY.md
git commit -m "feat(backend): add Dockerfile, compose reference, and Proxmox deploy docs"
```

---

## Self-Review Notes

- **Spec coverage:** shorthand dictionary (Task 5, 8), LLM fallback for both shorthand and goal text (Task 6, 7), static science table driving volume math (Task 4, 10), muscle heatmap data source (Task 10's `/progress` endpoint), session/history sync (Task 9), single-token auth (Task 3), Proxmox deployment via Cloudflare Tunnel (Task 11), swappable Ollama/Anthropic provider (Task 6) — all covered.
- **Placeholder scan:** none found; every step has runnable code.
- **Type consistency:** `LineGuess`/`GoalGuess` (Task 6) match the shapes consumed in Task 7's route and tests. `DictionaryResolution` (Task 5) matches what Task 7 spreads into its response. `MuscleGroup`/`GoalType` enums flow consistently from Prisma (Task 2) through `volumeTable.ts` (Task 4) into `goals.ts` (Task 10).
