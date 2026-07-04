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

func TestCreateExercise_ValidationErrors(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	h := NewExercisesHandler(q)

	for _, body := range []string{`{"name":"","muscles":["GLUTES"]}`, `{"name":"Valid Name","muscles":[]}`} {
		req := httptest.NewRequest(http.MethodPost, "/api/exercises", strings.NewReader(body))
		w := httptest.NewRecorder()
		h.Create(w, req)
		if w.Code != http.StatusBadRequest {
			t.Errorf("body %q: expected 400, got %d", body, w.Code)
		}
	}
}
