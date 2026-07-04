//go:build integration

package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DowLucas/strong-notes-backend/internal/auth"
	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/llm"
	"github.com/DowLucas/strong-notes-backend/internal/middleware"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
	"github.com/DowLucas/strong-notes-backend/testutil"
)

type fakeProvider struct {
	lineGuess llm.LineGuess
	lineErr   error
	goalGuess llm.GoalGuess
	goalErr   error
}

func (f *fakeProvider) ResolveLine(ctx context.Context, line string, unresolved []string) (llm.LineGuess, error) {
	return f.lineGuess, f.lineErr
}
func (f *fakeProvider) ResolveGoal(ctx context.Context, text string) (llm.GoalGuess, error) {
	return f.goalGuess, f.goalErr
}

// withClaims stores real *auth.Claims (the type middleware.ClaimsFromContext
// actually asserts against) in the request context under middleware.ClaimsKey.
func withClaims(r *http.Request, userID string) *http.Request {
	ctx := context.WithValue(r.Context(), middleware.ClaimsKey, &auth.Claims{UserID: userID})
	return r.WithContext(ctx)
}

func TestResolveLine_DictionaryOnly(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	ctx := context.Background()
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "resolve-test-dict@example.com")

	equipment := "equipment"
	barbell := "barbell"
	_, err := q.CreateAbbreviation(ctx, db.CreateAbbreviationParams{
		ID: ulid.New(), UserID: userID, Token: "BB", ModifierType: &equipment, ModifierValue: &barbell, Source: "BUILT_IN",
	})
	if err != nil {
		t.Fatalf("CreateAbbreviation: %v", err)
	}

	h := NewResolveHandler(q, &fakeProvider{})
	body := strings.NewReader(`{"line":"BB 40kg 8x3"}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/resolve/line", body), userID)
	w := httptest.NewRecorder()

	h.ResolveLine(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		ResolvedTokens   []map[string]any `json:"resolvedTokens"`
		UnresolvedTokens []string         `json:"unresolvedTokens"`
		LLMGuess         *llm.LineGuess   `json:"llmGuess"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(resp.UnresolvedTokens) != 0 {
		t.Errorf("expected no unresolved tokens, got %+v", resp.UnresolvedTokens)
	}
	if len(resp.ResolvedTokens) != 1 {
		t.Errorf("expected 1 resolved token (BB), got %d: %+v", len(resp.ResolvedTokens), resp.ResolvedTokens)
	}
	if resp.LLMGuess != nil {
		t.Errorf("expected no llmGuess when dictionary fully resolves the line, got %+v", resp.LLMGuess)
	}
}

// TestResolveLine_ResolvedTokensUseCamelCase is a regression test for the
// PascalCase JSON leak on parsing.ResolvedToken: the mobile client expects
// camelCase keys (token, type, exerciseId, modifierType, modifierValue) in
// resolvedTokens, not Go's default PascalCase field names.
func TestResolveLine_ResolvedTokensUseCamelCase(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	ctx := context.Background()
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "resolve-test-camelcase@example.com")

	equipment := "equipment"
	barbell := "barbell"
	_, err := q.CreateAbbreviation(ctx, db.CreateAbbreviationParams{
		ID: ulid.New(), UserID: userID, Token: "BB", ModifierType: &equipment, ModifierValue: &barbell, Source: "BUILT_IN",
	})
	if err != nil {
		t.Fatalf("CreateAbbreviation: %v", err)
	}

	exercisesH := NewExercisesHandler(q)
	exW := httptest.NewRecorder()
	exercisesH.Create(exW, httptest.NewRequest(http.MethodPost, "/api/exercises", strings.NewReader(`{"name":"Test Camel Case Squat","muscles":["QUADS"]}`)))
	var exercise struct {
		ID string `json:"id"`
	}
	json.Unmarshal(exW.Body.Bytes(), &exercise)
	_, err = q.CreateAbbreviation(ctx, db.CreateAbbreviationParams{
		ID: ulid.New(), UserID: userID, Token: "SQ", ExerciseID: &exercise.ID, Source: "BUILT_IN",
	})
	if err != nil {
		t.Fatalf("CreateAbbreviation (exercise): %v", err)
	}

	h := NewResolveHandler(q, &fakeProvider{})
	body := strings.NewReader(`{"line":"SQ BB 40kg 8x3"}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/resolve/line", body), userID)
	w := httptest.NewRecorder()

	h.ResolveLine(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var raw map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	resolvedTokens, ok := raw["resolvedTokens"].([]any)
	if !ok || len(resolvedTokens) != 2 {
		t.Fatalf("expected 2 resolvedTokens entries, got %+v", raw["resolvedTokens"])
	}

	var exerciseToken, modifierToken map[string]any
	for _, rt := range resolvedTokens {
		m := rt.(map[string]any)
		if m["type"] == "exercise" {
			exerciseToken = m
		} else if m["type"] == "modifier" {
			modifierToken = m
		}
	}
	if exerciseToken == nil {
		t.Fatalf("expected an exercise-type resolved token, got %+v", resolvedTokens)
	}
	if _, ok := exerciseToken["exerciseId"]; !ok {
		t.Errorf("expected camelCase \"exerciseId\" key on exercise token, got %+v", exerciseToken)
	}
	if _, ok := exerciseToken["ExerciseID"]; ok {
		t.Errorf("expected no PascalCase \"ExerciseID\" key, got %+v", exerciseToken)
	}

	if modifierToken == nil {
		t.Fatalf("expected a modifier-type resolved token, got %+v", resolvedTokens)
	}
	if _, ok := modifierToken["modifierType"]; !ok {
		t.Errorf("expected camelCase \"modifierType\" key on modifier token, got %+v", modifierToken)
	}
	if _, ok := modifierToken["ModifierType"]; ok {
		t.Errorf("expected no PascalCase \"ModifierType\" key, got %+v", modifierToken)
	}

	respBody := w.Body.String()
	if !strings.Contains(respBody, `"resolvedTokens":[{"token":`) {
		t.Errorf("expected resolvedTokens to start with camelCase \"token\" key, got %s", respBody)
	}
	if strings.Contains(respBody, `"ExerciseID"`) || strings.Contains(respBody, `"ModifierType"`) || strings.Contains(respBody, `"ModifierValue"`) {
		t.Errorf("expected no PascalCase keys in response, got %s", respBody)
	}
}

func TestResolveLine_LLMFallback(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "resolve-test-llm@example.com")

	weight := 40.0
	reps := 8
	sets := 3
	fake := &fakeProvider{
		lineGuess: llm.LineGuess{
			ExerciseName: "Bench Press",
			WeightKg:     &weight,
			Reps:         &reps,
			Sets:         &sets,
			Muscles:      []string{"chest", "triceps"},
		},
	}

	h := NewResolveHandler(q, fake)
	// "WXYZ" has no dictionary entry for this user, so it must fall through
	// to the LLM provider.
	body := strings.NewReader(`{"line":"WXYZ 40kg 8x3"}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/resolve/line", body), userID)
	w := httptest.NewRecorder()

	h.ResolveLine(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		UnresolvedTokens []string      `json:"unresolvedTokens"`
		LLMGuess         llm.LineGuess `json:"llmGuess"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(resp.UnresolvedTokens) != 1 || resp.UnresolvedTokens[0] != "WXYZ" {
		t.Fatalf("expected unresolved [WXYZ], got %+v", resp.UnresolvedTokens)
	}
	if resp.LLMGuess.ExerciseName != "Bench Press" {
		t.Errorf("expected llmGuess.exerciseName from fakeProvider, got %+v", resp.LLMGuess)
	}
	if len(resp.LLMGuess.Muscles) != 2 {
		t.Errorf("expected llmGuess.muscles to round-trip, got %+v", resp.LLMGuess.Muscles)
	}
}

func TestResolveLine_MissingLine(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "resolve-test-missing@example.com")

	h := NewResolveHandler(q, &fakeProvider{})
	body := strings.NewReader(`{"line":""}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/resolve/line", body), userID)
	w := httptest.NewRecorder()

	h.ResolveLine(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty line, got %d: %s", w.Code, w.Body.String())
	}
}

func TestResolveGoal(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "resolve-test-goal@example.com")

	fake := &fakeProvider{
		goalGuess: llm.GoalGuess{Type: "hypertrophy", Muscles: []string{"back", "biceps"}},
	}
	h := NewResolveHandler(q, fake)

	body := strings.NewReader(`{"text":"I want a bigger back"}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/resolve/goal", body), userID)
	w := httptest.NewRecorder()

	h.ResolveGoal(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp llm.GoalGuess
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp.Type != "hypertrophy" {
		t.Errorf("expected type hypertrophy, got %q", resp.Type)
	}
	if len(resp.Muscles) != 2 {
		t.Errorf("expected 2 muscles, got %+v", resp.Muscles)
	}
}

func TestResolveGoal_MissingText(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "resolve-test-goal-missing@example.com")

	h := NewResolveHandler(q, &fakeProvider{})
	body := strings.NewReader(`{"text":""}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/resolve/goal", body), userID)
	w := httptest.NewRecorder()

	h.ResolveGoal(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty text, got %d: %s", w.Code, w.Body.String())
	}
}
