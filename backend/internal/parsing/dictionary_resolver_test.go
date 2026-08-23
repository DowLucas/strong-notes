//go:build integration

package parsing

import (
	"context"
	"testing"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
	"github.com/DowLucas/strong-notes-backend/testutil"
)

func TestResolveLineWithDictionary(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	ctx := context.Background()

	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "resolver-test@example.com")

	exercise, err := q.CreateExercise(ctx, db.CreateExerciseParams{ID: ulid.New(), Name: "Test Squat", Category: "COMPOUND"})
	if err != nil {
		t.Fatalf("CreateExercise: %v", err)
	}
	_, err = q.CreateAbbreviation(ctx, db.CreateAbbreviationParams{
		ID: ulid.New(), UserID: userID, Token: "TSQ", ExerciseID: &exercise.ID, Source: "USER_ADDED",
	})
	if err != nil {
		t.Fatalf("CreateAbbreviation (exercise): %v", err)
	}
	barbell := "barbell"
	equipment := "equipment"
	_, err = q.CreateAbbreviation(ctx, db.CreateAbbreviationParams{
		ID: ulid.New(), UserID: userID, Token: "BB", ModifierType: &equipment, ModifierValue: &barbell, Source: "BUILT_IN",
	})
	if err != nil {
		t.Fatalf("CreateAbbreviation (modifier): %v", err)
	}

	// Mixed case in both the stored tokens and the line must still match:
	// users type "deadlifts" and "Bench" and the dictionary must be
	// case-insensitive.
	lower := "Test Bench"
	benchEx, err := q.CreateExercise(ctx, db.CreateExerciseParams{ID: ulid.New(), Name: lower, Category: "COMPOUND"})
	if err != nil {
		t.Fatalf("CreateExercise: %v", err)
	}
	if _, err := q.CreateAbbreviation(ctx, db.CreateAbbreviationParams{
		ID: ulid.New(), UserID: userID, Token: "bench", ExerciseID: &benchEx.ID, Source: "USER_ADDED",
	}); err != nil {
		t.Fatalf("CreateAbbreviation (lowercase): %v", err)
	}
	lowerResult, err := ResolveLineWithDictionary(ctx, q, userID, "Bench 60kg 8x3")
	if err != nil {
		t.Fatalf("ResolveLineWithDictionary (lowercase): %v", err)
	}
	if len(lowerResult.ResolvedTokens) != 1 || lowerResult.ResolvedTokens[0].ExerciseID == nil || *lowerResult.ResolvedTokens[0].ExerciseID != benchEx.ID {
		t.Fatalf("expected 'Bench' to resolve via lowercase 'bench' abbreviation, got %+v / unresolved %+v", lowerResult.ResolvedTokens, lowerResult.UnresolvedTokens)
	}

	result, err := ResolveLineWithDictionary(ctx, q, userID, "tsq bb 40kg 8x3 WXYZ")
	if err != nil {
		t.Fatalf("ResolveLineWithDictionary: %v", err)
	}

	if len(result.ResolvedTokens) != 2 {
		t.Fatalf("expected 2 resolved tokens, got %d: %+v", len(result.ResolvedTokens), result.ResolvedTokens)
	}
	if len(result.UnresolvedTokens) != 1 || result.UnresolvedTokens[0] != "WXYZ" {
		t.Fatalf("expected unresolved [WXYZ], got %+v", result.UnresolvedTokens)
	}
	ex := result.ResolvedTokens[0]
	if ex.Type != "exercise" || ex.ExerciseName == nil || *ex.ExerciseName != "Test Squat" {
		t.Fatalf("expected exercise token with name Test Squat, got %+v", ex)
	}
	if result.ResolvedTokens[1].ExerciseName != nil {
		t.Fatalf("modifier token must not carry an exercise name: %+v", result.ResolvedTokens[1])
	}
}

func TestResolveLineWithDictionary_BuiltInEquipmentShorthand(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	ctx := context.Background()

	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "resolver-shorthand@example.com")
	ex, err := q.CreateExercise(ctx, db.CreateExerciseParams{ID: ulid.New(), Name: "Barbell Deadlift", Category: "COMPOUND"})
	if err != nil {
		t.Fatalf("CreateExercise: %v", err)
	}
	if _, err := q.CreateAbbreviation(ctx, db.CreateAbbreviationParams{
		ID: ulid.New(), UserID: userID, Token: "DEADLIFTS", ExerciseID: &ex.ID, Source: "USER_ADDED",
	}); err != nil {
		t.Fatalf("CreateAbbreviation: %v", err)
	}

	// "bb" has no user abbreviation but is built-in equipment shorthand: the
	// line must fully resolve (no unresolved tokens → no LLM round-trip).
	result, err := ResolveLineWithDictionary(ctx, q, userID, "bb deadlifts 60kg 8x3")
	if err != nil {
		t.Fatalf("ResolveLineWithDictionary: %v", err)
	}
	if len(result.UnresolvedTokens) != 0 {
		t.Fatalf("expected no unresolved tokens, got %v", result.UnresolvedTokens)
	}
	if len(result.ResolvedTokens) != 2 {
		t.Fatalf("expected 2 resolved tokens, got %+v", result.ResolvedTokens)
	}
	mod := result.ResolvedTokens[0]
	if mod.Type != "modifier" || mod.ModifierType == nil || *mod.ModifierType != "equipment" || mod.ModifierValue == nil || *mod.ModifierValue != "Barbell" {
		t.Fatalf("expected bb → equipment Barbell modifier, got %+v", mod)
	}

	// A user's own entry for the same token wins over the built-in table.
	custom := "Bosu Ball"
	eq := "equipment"
	if _, err := q.CreateAbbreviation(ctx, db.CreateAbbreviationParams{
		ID: ulid.New(), UserID: userID, Token: "BB", ModifierType: &eq, ModifierValue: &custom, Source: "USER_ADDED",
	}); err != nil {
		t.Fatalf("CreateAbbreviation (custom bb): %v", err)
	}
	result, err = ResolveLineWithDictionary(ctx, q, userID, "bb deadlifts")
	if err != nil {
		t.Fatalf("ResolveLineWithDictionary: %v", err)
	}
	if result.ResolvedTokens[0].ModifierValue == nil || *result.ResolvedTokens[0].ModifierValue != "Bosu Ball" {
		t.Fatalf("expected user entry to win, got %+v", result.ResolvedTokens[0])
	}
}
