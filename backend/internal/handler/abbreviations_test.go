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
	req := httptest.NewRequest(http.MethodPatch, "/api/abbreviations/"+pending.ID+"/confirm", nil)
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
