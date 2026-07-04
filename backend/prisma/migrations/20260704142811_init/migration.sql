-- CreateEnum
CREATE TYPE "MuscleGroup" AS ENUM ('GLUTES', 'QUADS', 'HAMSTRINGS', 'CHEST', 'BACK', 'SHOULDERS', 'ARMS', 'CORE', 'CALVES');

-- CreateEnum
CREATE TYPE "MuscleRole" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateEnum
CREATE TYPE "ExerciseCategory" AS ENUM ('COMPOUND', 'ISOLATION');

-- CreateEnum
CREATE TYPE "AbbreviationSource" AS ENUM ('BUILT_IN', 'USER_ADDED', 'LLM_SUGGESTED_PENDING_CONFIRM');

-- CreateEnum
CREATE TYPE "ParsedBy" AS ENUM ('DICTIONARY', 'LLM');

-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('HYPERTROPHY', 'STRENGTH', 'ENDURANCE', 'CUSTOM');

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ExerciseCategory" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MuscleMapEntry" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "muscle" "MuscleGroup" NOT NULL,
    "role" "MuscleRole" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "MuscleMapEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Abbreviation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'lucas',
    "token" TEXT NOT NULL,
    "exerciseId" TEXT,
    "modifierType" TEXT,
    "modifierValue" TEXT,
    "source" "AbbreviationSource" NOT NULL DEFAULT 'USER_ADDED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Abbreviation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'lucas',
    "date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "exerciseId" TEXT,
    "equipment" TEXT,
    "weightKg" DOUBLE PRECISION,
    "reps" INTEGER,
    "sets" INTEGER,
    "rawText" TEXT NOT NULL,
    "parsedBy" "ParsedBy" NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'lucas',
    "type" "GoalType" NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalTarget" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "muscle" "MuscleGroup" NOT NULL,
    "minSetsPerWeek" INTEGER NOT NULL,
    "maxSetsPerWeek" INTEGER NOT NULL,

    CONSTRAINT "GoalTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_name_key" ON "Exercise"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Abbreviation_userId_token_key" ON "Abbreviation"("userId", "token");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutSession_userId_date_key" ON "WorkoutSession"("userId", "date");

-- AddForeignKey
ALTER TABLE "MuscleMapEntry" ADD CONSTRAINT "MuscleMapEntry_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Abbreviation" ADD CONSTRAINT "Abbreviation_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetEntry" ADD CONSTRAINT "SetEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetEntry" ADD CONSTRAINT "SetEntry_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalTarget" ADD CONSTRAINT "GoalTarget_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
