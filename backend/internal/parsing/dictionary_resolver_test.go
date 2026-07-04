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

	result, err := ResolveLineWithDictionary(ctx, q, userID, "TSQ BB 40kg 8x3 WXYZ")
	if err != nil {
		t.Fatalf("ResolveLineWithDictionary: %v", err)
	}

	if len(result.ResolvedTokens) != 2 {
		t.Fatalf("expected 2 resolved tokens, got %d: %+v", len(result.ResolvedTokens), result.ResolvedTokens)
	}
	if len(result.UnresolvedTokens) != 1 || result.UnresolvedTokens[0] != "WXYZ" {
		t.Fatalf("expected unresolved [WXYZ], got %+v", result.UnresolvedTokens)
	}
}
