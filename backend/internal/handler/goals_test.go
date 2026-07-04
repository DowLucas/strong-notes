//go:build integration

package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
	"github.com/DowLucas/strong-notes-backend/testutil"
)

func TestGoals_CreateDefaultsFromVolumeTable(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "goals-test@example.com")
	h := NewGoalsHandler(pool, q)

	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/goals", strings.NewReader(`{"type":"HYPERTROPHY"}`)), userID)
	w := httptest.NewRecorder()
	h.Create(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Targets []struct {
			Muscle         string `json:"muscle"`
			MinSetsPerWeek int    `json:"minSetsPerWeek"`
			MaxSetsPerWeek int    `json:"maxSetsPerWeek"`
		} `json:"targets"`
	}
	json.Unmarshal(w.Body.Bytes(), &resp)
	found := false
	for _, target := range resp.Targets {
		if target.Muscle == "GLUTES" {
			found = true
			if target.MinSetsPerWeek != 12 || target.MaxSetsPerWeek != 20 {
				t.Errorf("expected GLUTES 12-20, got %d-%d", target.MinSetsPerWeek, target.MaxSetsPerWeek)
			}
		}
	}
	if !found {
		t.Fatal("expected a GLUTES target in the created goal")
	}
}

func TestGoals_ActiveProgress_ComputesActualSets(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "goals-progress-test@example.com")
	h := NewGoalsHandler(pool, q)

	createReq := withClaims(httptest.NewRequest(http.MethodPost, "/api/goals", strings.NewReader(`{"type":"HYPERTROPHY"}`)), userID)
	h.Create(httptest.NewRecorder(), createReq)

	exercisesH := NewExercisesHandler(q)
	exW := httptest.NewRecorder()
	exercisesH.Create(exW, httptest.NewRequest(http.MethodPost, "/api/exercises", strings.NewReader(`{"name":"Test Hip Thrust For Goals","muscles":["GLUTES"]}`)))
	var exercise struct {
		ID string `json:"id"`
	}
	json.Unmarshal(exW.Body.Bytes(), &exercise)

	sessionsH := NewSessionsHandler(pool, q)
	putRouter := chi.NewRouter()
	putRouter.Put("/api/sessions/{date}", sessionsH.Put)
	putBody := `{"entries":[{"exerciseId":"` + exercise.ID + `","sets":4,"rawText":"HT 40kg 8x4","parsedBy":"DICTIONARY","order":0}]}`
	putReq := withClaims(httptest.NewRequest(http.MethodPut, "/api/sessions/2026-07-06", strings.NewReader(putBody)), userID)
	putW := httptest.NewRecorder()
	putRouter.ServeHTTP(putW, putReq)
	if putW.Code != http.StatusOK {
		t.Fatalf("setup PUT: expected 200, got %d: %s", putW.Code, putW.Body.String())
	}

	progressReq := withClaims(httptest.NewRequest(http.MethodGet, "/api/goals/active/progress?weekStart=2026-07-06", nil), userID)
	progressW := httptest.NewRecorder()
	h.GetActiveProgress(progressW, progressReq)

	var progress []struct {
		Muscle     string `json:"muscle"`
		ActualSets int    `json:"actualSets"`
	}
	json.Unmarshal(progressW.Body.Bytes(), &progress)
	found := false
	for _, p := range progress {
		if p.Muscle == "GLUTES" {
			found = true
			if p.ActualSets != 4 {
				t.Errorf("expected GLUTES actualSets 4, got %d", p.ActualSets)
			}
		}
	}
	if !found {
		t.Fatal("expected a GLUTES entry in progress response")
	}
}

// TestGoals_ActiveProgress_WeightsSecondaryMuscles is a regression test
// proving actualSets is computed as sets * muscle weight, not raw sets: an
// exercise with a PRIMARY (weight 1.0) and SECONDARY (weight 0.5) muscle,
// logged with 4 sets, should show actualSets 4 for the PRIMARY muscle and
// actualSets 2 (4 * 0.5, rounded) for the SECONDARY muscle.
func TestGoals_ActiveProgress_WeightsSecondaryMuscles(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "goals-weighted-progress-test@example.com")
	h := NewGoalsHandler(pool, q)

	createReq := withClaims(httptest.NewRequest(http.MethodPost, "/api/goals", strings.NewReader(`{"type":"HYPERTROPHY"}`)), userID)
	h.Create(httptest.NewRecorder(), createReq)

	// QUADS is the first (PRIMARY, weight 1.0) muscle, GLUTES is the second
	// (SECONDARY, weight 0.5) muscle per exercises.Create's position-based rule.
	exercisesH := NewExercisesHandler(q)
	exW := httptest.NewRecorder()
	exercisesH.Create(exW, httptest.NewRequest(http.MethodPost, "/api/exercises", strings.NewReader(`{"name":"Test Weighted Lunge For Goals","muscles":["QUADS","GLUTES"]}`)))
	var exercise struct {
		ID string `json:"id"`
	}
	json.Unmarshal(exW.Body.Bytes(), &exercise)

	sessionsH := NewSessionsHandler(pool, q)
	putRouter := chi.NewRouter()
	putRouter.Put("/api/sessions/{date}", sessionsH.Put)
	putBody := `{"entries":[{"exerciseId":"` + exercise.ID + `","sets":4,"rawText":"Lunge 40kg 8x4","parsedBy":"DICTIONARY","order":0}]}`
	putReq := withClaims(httptest.NewRequest(http.MethodPut, "/api/sessions/2026-07-06", strings.NewReader(putBody)), userID)
	putW := httptest.NewRecorder()
	putRouter.ServeHTTP(putW, putReq)
	if putW.Code != http.StatusOK {
		t.Fatalf("setup PUT: expected 200, got %d: %s", putW.Code, putW.Body.String())
	}

	progressReq := withClaims(httptest.NewRequest(http.MethodGet, "/api/goals/active/progress?weekStart=2026-07-06", nil), userID)
	progressW := httptest.NewRecorder()
	h.GetActiveProgress(progressW, progressReq)

	var progress []struct {
		Muscle     string `json:"muscle"`
		ActualSets int    `json:"actualSets"`
	}
	json.Unmarshal(progressW.Body.Bytes(), &progress)
	byMuscle := make(map[string]int, len(progress))
	for _, p := range progress {
		byMuscle[p.Muscle] = p.ActualSets
	}
	if got, ok := byMuscle["QUADS"]; !ok || got != 4 {
		t.Errorf("expected QUADS (PRIMARY, weight 1.0) actualSets 4, got %d (found=%v)", got, ok)
	}
	if got, ok := byMuscle["GLUTES"]; !ok || got != 2 {
		t.Errorf("expected GLUTES (SECONDARY, weight 0.5) actualSets 2, got %d (found=%v)", got, ok)
	}
}

// TestGoals_Create_InvalidTypeReturns400 is a regression test proving an
// unrecognized goal type is rejected with a 400 before it ever reaches the
// DB's CHECK constraint (which previously surfaced as an opaque 500).
func TestGoals_Create_InvalidTypeReturns400(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "goals-invalid-type-test@example.com")
	h := NewGoalsHandler(pool, q)

	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/goals", strings.NewReader(`{"type":"NOT_A_REAL_TYPE"}`)), userID)
	w := httptest.NewRecorder()
	h.Create(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid type, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGoals_GetActive_ReturnsCamelCaseTargets(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "goals-active-test@example.com")
	h := NewGoalsHandler(pool, q)

	createReq := withClaims(httptest.NewRequest(http.MethodPost, "/api/goals", strings.NewReader(`{"type":"HYPERTROPHY"}`)), userID)
	h.Create(httptest.NewRecorder(), createReq)

	getReq := withClaims(httptest.NewRequest(http.MethodGet, "/api/goals/active", nil), userID)
	getW := httptest.NewRecorder()
	h.GetActive(getW, getReq)

	if getW.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", getW.Code, getW.Body.String())
	}
	body := getW.Body.String()
	if !strings.Contains(body, `"minSetsPerWeek"`) || !strings.Contains(body, `"maxSetsPerWeek"`) {
		t.Errorf("expected camelCase target keys, got %s", body)
	}
	if strings.Contains(body, `"min_sets_per_week"`) || strings.Contains(body, `"user_id"`) {
		t.Errorf("expected no snake_case keys, got %s", body)
	}
}
