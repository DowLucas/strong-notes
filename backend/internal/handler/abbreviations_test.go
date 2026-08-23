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
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
	"github.com/DowLucas/strong-notes-backend/testutil"
	"github.com/go-chi/chi/v5"
)

func TestAbbreviations_CreateAndList(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "abbrev-test@example.com")
	h := NewAbbreviationsHandler(q)

	body := `{"token":"ZZTEST","modifierType":"equipment","modifierValue":"kettlebell"}`
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/abbreviations", strings.NewReader(body)), userID)
	w := httptest.NewRecorder()
	h.Create(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created struct {
		Source string `json:"source"`
	}
	json.Unmarshal(w.Body.Bytes(), &created)
	if created.Source != "USER_ADDED" {
		t.Errorf("expected source USER_ADDED, got %s", created.Source)
	}

	listReq := withClaims(httptest.NewRequest(http.MethodGet, "/api/abbreviations", nil), userID)
	listW := httptest.NewRecorder()
	h.List(listW, listReq)
	var list []struct {
		Token string `json:"token"`
	}
	json.Unmarshal(listW.Body.Bytes(), &list)
	found := false
	for _, a := range list {
		if a.Token == "ZZTEST" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected ZZTEST in list, got %+v", list)
	}
}

func TestAbbreviations_CreateIsCaseInsensitiveOnToken(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "abbrev-case-test@example.com")
	h := NewAbbreviationsHandler(q)

	create := func(body string) *httptest.ResponseRecorder {
		req := withClaims(httptest.NewRequest(http.MethodPost, "/api/abbreviations", strings.NewReader(body)), userID)
		w := httptest.NewRecorder()
		h.Create(w, req)
		return w
	}
	first := create(`{"token":"deadlifts","modifierType":"equipment","modifierValue":"x"}`)
	if first.Code != http.StatusCreated {
		t.Fatalf("first create: %d %s", first.Code, first.Body.String())
	}
	var created struct {
		ID    string `json:"id"`
		Token string `json:"token"`
	}
	json.Unmarshal(first.Body.Bytes(), &created)
	if created.Token != "DEADLIFTS" {
		t.Fatalf("token stored as %q, want canonical uppercase DEADLIFTS", created.Token)
	}
	// Same token in another case is the same abbreviation, not a second row.
	second := create(`{"token":"Deadlifts","modifierType":"equipment","modifierValue":"x"}`)
	var again struct {
		ID string `json:"id"`
	}
	json.Unmarshal(second.Body.Bytes(), &again)
	if again.ID != created.ID {
		t.Fatalf("expected idempotent create for differently-cased token, got ids %q vs %q", created.ID, again.ID)
	}
}

func TestAbbreviations_ListIncludesExerciseName(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	ctx := context.Background()
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "abbrev-name-test@example.com")
	h := NewAbbreviationsHandler(q)

	exercise, err := q.CreateExercise(ctx, db.CreateExerciseParams{ID: ulid.New(), Name: "Barbell Deadlift", Category: "COMPOUND"})
	if err != nil {
		t.Fatalf("CreateExercise: %v", err)
	}
	if _, err := q.CreateAbbreviation(ctx, db.CreateAbbreviationParams{
		ID: ulid.New(), UserID: userID, Token: "DEADLIFTS", ExerciseID: &exercise.ID, Source: "USER_ADDED",
	}); err != nil {
		t.Fatalf("CreateAbbreviation: %v", err)
	}

	listReq := withClaims(httptest.NewRequest(http.MethodGet, "/api/abbreviations", nil), userID)
	listW := httptest.NewRecorder()
	h.List(listW, listReq)
	var list []struct {
		Token        string  `json:"token"`
		ExerciseName *string `json:"exerciseName"`
	}
	json.Unmarshal(listW.Body.Bytes(), &list)
	if len(list) != 1 || list[0].ExerciseName == nil || *list[0].ExerciseName != "Barbell Deadlift" {
		t.Fatalf("expected exerciseName Barbell Deadlift, got %+v", list)
	}
}

func TestAbbreviations_ConfirmPending(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "abbrev-confirm-test@example.com")
	h := NewAbbreviationsHandler(q)

	equipment := "equipment"
	sled := "sled"
	pending, err := q.CreateAbbreviation(context.Background(), db.CreateAbbreviationParams{
		ID: ulid.New(), UserID: userID, Token: "ZZPEND", ModifierType: &equipment, ModifierValue: &sled, Source: "LLM_SUGGESTED_PENDING_CONFIRM",
	})
	if err != nil {
		t.Fatalf("seed CreateAbbreviation: %v", err)
	}

	// Simulate chi's URL-param routing without standing up a full router:
	// stash a route context carrying "id" and attach it the way chi's
	// middleware does, so chi.URLParam(r, "id") resolves inside the handler.
	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("id", pending.ID)
	req := withClaims(httptest.NewRequest(http.MethodPatch, "/api/abbreviations/"+pending.ID+"/confirm", nil), userID)
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
	w := httptest.NewRecorder()

	h.Confirm(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var confirmed struct {
		Source string `json:"source"`
	}
	json.Unmarshal(w.Body.Bytes(), &confirmed)
	if confirmed.Source != "USER_ADDED" {
		t.Errorf("expected source USER_ADDED after confirm, got %s", confirmed.Source)
	}
}

// TestAbbreviations_ConfirmRejectsOtherUsersAbbreviation is a regression test
// for the IDOR fix: confirming an abbreviation you don't own must 404, not
// mutate someone else's row.
func TestAbbreviations_ConfirmRejectsOtherUsersAbbreviation(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	ownerID := ulid.New()
	attackerID := ulid.New()
	testutil.InsertTestUser(t, pool, ownerID, "abbrev-owner@example.com")
	testutil.InsertTestUser(t, pool, attackerID, "abbrev-attacker@example.com")
	h := NewAbbreviationsHandler(q)

	equipment := "equipment"
	sled := "sled"
	pending, err := q.CreateAbbreviation(context.Background(), db.CreateAbbreviationParams{
		ID: ulid.New(), UserID: ownerID, Token: "ZZOWNED", ModifierType: &equipment, ModifierValue: &sled, Source: "LLM_SUGGESTED_PENDING_CONFIRM",
	})
	if err != nil {
		t.Fatalf("seed CreateAbbreviation: %v", err)
	}

	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("id", pending.ID)
	attackerReq := withClaims(httptest.NewRequest(http.MethodPatch, "/api/abbreviations/"+pending.ID+"/confirm", nil), attackerID)
	attackerReq = attackerReq.WithContext(context.WithValue(attackerReq.Context(), chi.RouteCtxKey, routeCtx))
	attackerW := httptest.NewRecorder()

	h.Confirm(attackerW, attackerReq)

	if attackerW.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for a different user's confirm attempt, got %d: %s", attackerW.Code, attackerW.Body.String())
	}

	// The rightful owner's confirm must still succeed.
	ownerRouteCtx := chi.NewRouteContext()
	ownerRouteCtx.URLParams.Add("id", pending.ID)
	ownerReq := withClaims(httptest.NewRequest(http.MethodPatch, "/api/abbreviations/"+pending.ID+"/confirm", nil), ownerID)
	ownerReq = ownerReq.WithContext(context.WithValue(ownerReq.Context(), chi.RouteCtxKey, ownerRouteCtx))
	ownerW := httptest.NewRecorder()

	h.Confirm(ownerW, ownerReq)

	if ownerW.Code != http.StatusOK {
		t.Fatalf("expected 200 for the owner's confirm, got %d: %s", ownerW.Code, ownerW.Body.String())
	}
	var confirmed struct {
		Source string `json:"source"`
	}
	json.Unmarshal(ownerW.Body.Bytes(), &confirmed)
	if confirmed.Source != "USER_ADDED" {
		t.Errorf("expected source USER_ADDED after owner confirm, got %s", confirmed.Source)
	}
}

// TestAbbreviations_ResponsesUseCamelCase is a regression test for the JSON
// snake_case leak: List/Create must serialize camelCase keys like
// "exerciseId"/"createdAt", never the sqlc-generated "exercise_id"/"created_at".
func TestAbbreviations_ResponsesUseCamelCase(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "abbrev-camel-test@example.com")
	h := NewAbbreviationsHandler(q)

	body := `{"token":"ZZCAMEL","modifierType":"equipment","modifierValue":"kettlebell"}`
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/abbreviations", strings.NewReader(body)), userID)
	w := httptest.NewRecorder()
	h.Create(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	createBody := w.Body.String()
	if !strings.Contains(createBody, `"createdAt"`) {
		t.Errorf("expected camelCase \"createdAt\" in Create response, got %s", createBody)
	}
	if strings.Contains(createBody, `"created_at"`) || strings.Contains(createBody, `"modifier_type"`) {
		t.Errorf("expected no snake_case keys in Create response, got %s", createBody)
	}

	listReq := withClaims(httptest.NewRequest(http.MethodGet, "/api/abbreviations", nil), userID)
	listW := httptest.NewRecorder()
	h.List(listW, listReq)
	if listW.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", listW.Code, listW.Body.String())
	}
	listBody := listW.Body.String()
	if !strings.Contains(listBody, `"createdAt"`) {
		t.Errorf("expected camelCase \"createdAt\" in List response, got %s", listBody)
	}
	if strings.Contains(listBody, `"created_at"`) || strings.Contains(listBody, `"modifier_type"`) {
		t.Errorf("expected no snake_case keys in List response, got %s", listBody)
	}
}
