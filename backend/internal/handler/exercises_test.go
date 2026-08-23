//go:build integration

package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/testutil"
)

func TestCreateExercise_NewAndDedupe(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	h := NewExercisesHandler(q)

	body := `{"name":"Test Crab Walk","muscles":["GLUTES","CORE"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/exercises", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.Create(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var first struct {
		ID string `json:"id"`
	}
	json.Unmarshal(w.Body.Bytes(), &first)

	muscleMap, err := q.GetMuscleMapForExercise(context.Background(), first.ID)
	if err != nil {
		t.Fatalf("GetMuscleMapForExercise: %v", err)
	}
	if len(muscleMap) != 2 {
		t.Fatalf("expected 2 muscle map entries, got %d", len(muscleMap))
	}

	// Second POST with the same name must return the SAME exercise, not create a duplicate.
	req2 := httptest.NewRequest(http.MethodPost, "/api/exercises", strings.NewReader(body))
	w2 := httptest.NewRecorder()
	h.Create(w2, req2)

	var second struct {
		ID string `json:"id"`
	}
	json.Unmarshal(w2.Body.Bytes(), &second)
	if second.ID != first.ID {
		t.Errorf("expected same exercise id on duplicate name, got %s vs %s", first.ID, second.ID)
	}
}

// TestCreateExercise_DedupesMuscles is a regression test proving that
// duplicate muscles in the request collapse to one MuscleMapEntry per
// unique muscle instead of one row per occurrence.
func TestCreateExercise_DedupesMuscles(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	h := NewExercisesHandler(q)

	body := `{"name":"Test Duplicate Muscle Squat","muscles":["GLUTES","GLUTES","CORE"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/exercises", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.Create(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	json.Unmarshal(w.Body.Bytes(), &created)

	muscleMap, err := q.GetMuscleMapForExercise(context.Background(), created.ID)
	if err != nil {
		t.Fatalf("GetMuscleMapForExercise: %v", err)
	}
	if len(muscleMap) != 2 {
		t.Fatalf("expected 2 unique muscle map entries (GLUTES deduped), got %d: %+v", len(muscleMap), muscleMap)
	}
	seen := map[string]int{}
	for _, m := range muscleMap {
		seen[m.Muscle]++
	}
	if seen["GLUTES"] != 1 {
		t.Errorf("expected exactly 1 GLUTES entry, got %d", seen["GLUTES"])
	}
	if seen["CORE"] != 1 {
		t.Errorf("expected exactly 1 CORE entry, got %d", seen["CORE"])
	}
}

// TestCreateExercise_ResponseUsesCamelCase is a regression test for the JSON
// snake_case leak: Create must serialize camelCase keys like "createdAt",
// never the sqlc-generated "created_at".
func TestCreateExercise_ResponseUsesCamelCase(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	h := NewExercisesHandler(q)

	body := `{"name":"Test Camel Case Exercise","muscles":["GLUTES"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/exercises", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.Create(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	respBody := w.Body.String()
	if !strings.Contains(respBody, `"createdAt"`) {
		t.Errorf("expected camelCase \"createdAt\" in response, got %s", respBody)
	}
	if strings.Contains(respBody, `"created_at"`) {
		t.Errorf("expected no snake_case \"created_at\" in response, got %s", respBody)
	}
}

// TestCreateExercise_AssignsRoleAndWeightByPosition is a regression test
// proving muscle map entries get real per-position role/weight instead of
// the old hardcoded PRIMARY/weight-1 for every muscle: the first muscle in
// the deduped list is PRIMARY/1.0, every subsequent muscle is SECONDARY/0.5.
func TestCreateExercise_AssignsRoleAndWeightByPosition(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	h := NewExercisesHandler(q)

	body := `{"name":"Test Weighted Muscle Lunge","muscles":["QUADS","GLUTES"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/exercises", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.Create(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	json.Unmarshal(w.Body.Bytes(), &created)

	muscleMap, err := q.GetMuscleMapForExercise(context.Background(), created.ID)
	if err != nil {
		t.Fatalf("GetMuscleMapForExercise: %v", err)
	}
	if len(muscleMap) != 2 {
		t.Fatalf("expected 2 muscle map entries, got %d", len(muscleMap))
	}

	byMuscle := make(map[string]db.MuscleMapEntry, len(muscleMap))
	for _, m := range muscleMap {
		byMuscle[m.Muscle] = m
	}

	primary, ok := byMuscle["QUADS"]
	if !ok {
		t.Fatalf("expected a QUADS muscle map entry, got %+v", muscleMap)
	}
	if primary.Role != "PRIMARY" || primary.Weight != 1.0 {
		t.Errorf("expected QUADS (first muscle) to be PRIMARY/1.0, got %s/%v", primary.Role, primary.Weight)
	}

	secondary, ok := byMuscle["GLUTES"]
	if !ok {
		t.Fatalf("expected a GLUTES muscle map entry, got %+v", muscleMap)
	}
	if secondary.Role != "SECONDARY" || secondary.Weight != 0.5 {
		t.Errorf("expected GLUTES (second muscle) to be SECONDARY/0.5, got %s/%v", secondary.Role, secondary.Weight)
	}
}

func TestCreateExercise_ValidationErrors(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	h := NewExercisesHandler(q)

	for _, body := range []string{`{"name":"","muscles":["GLUTES"]}`, `{"name":"Valid Name","muscles":["NOPE"]}`} {
		req := httptest.NewRequest(http.MethodPost, "/api/exercises", strings.NewReader(body))
		w := httptest.NewRecorder()
		h.Create(w, req)
		if w.Code != http.StatusBadRequest {
			t.Errorf("body %q: expected 400, got %d", body, w.Code)
		}
	}
}

func TestCreateExercise_AllowsEmptyMuscles(t *testing.T) {
	// The LLM guess is normalized against the taxonomy and may end up with no
	// recognised muscle; confirming the exercise must still succeed.
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	h := NewExercisesHandler(q)

	req := httptest.NewRequest(http.MethodPost, "/api/exercises", strings.NewReader(`{"name":"Unclassified Move","muscles":[]}`))
	w := httptest.NewRecorder()
	h.Create(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}
