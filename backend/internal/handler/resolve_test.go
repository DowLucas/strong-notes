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
