//go:build integration

package handler

import (
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

func TestSessions_UpsertReplacesEntries(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "sessions-test@example.com")
	h := NewSessionsHandler(pool, q)

	router := chi.NewRouter()
	router.Put("/api/sessions/{date}", h.Put)

	putBody := func(body string) *httptest.ResponseRecorder {
		req := withClaims(httptest.NewRequest(http.MethodPut, "/api/sessions/2026-07-04", strings.NewReader(body)), userID)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}

	w1 := putBody(`{"entries":[{"rawText":"first","parsedBy":"DICTIONARY","order":0}]}`)
	if w1.Code != http.StatusOK {
		t.Fatalf("first PUT: expected 200, got %d: %s", w1.Code, w1.Body.String())
	}

	w2 := putBody(`{"entries":[{"rawText":"second","parsedBy":"DICTIONARY","order":0}]}`)
	var resp struct {
		Entries []struct {
			RawText string `json:"rawText"`
		} `json:"entries"`
	}
	json.Unmarshal(w2.Body.Bytes(), &resp)
	if len(resp.Entries) != 1 || resp.Entries[0].RawText != "second" {
		t.Fatalf("expected exactly 1 entry with rawText 'second', got %+v", resp.Entries)
	}
}

func TestSessions_Get_ReturnsSessionsInRange(t *testing.T) {
	pool := testutil.SharedDB(t)
	q := db.New(pool)
	userID := ulid.New()
	testutil.InsertTestUser(t, pool, userID, "sessions-get-test@example.com")
	h := NewSessionsHandler(pool, q)

	putRouter := chi.NewRouter()
	putRouter.Put("/api/sessions/{date}", h.Put)

	putReq := withClaims(httptest.NewRequest(http.MethodPut, "/api/sessions/2026-07-04", strings.NewReader(`{"entries":[{"rawText":"squat","parsedBy":"DICTIONARY","order":0}]}`)), userID)
	putW := httptest.NewRecorder()
	putRouter.ServeHTTP(putW, putReq)
	if putW.Code != http.StatusOK {
		t.Fatalf("setup PUT: expected 200, got %d: %s", putW.Code, putW.Body.String())
	}

	getReq := withClaims(httptest.NewRequest(http.MethodGet, "/api/sessions?from=2026-07-01&to=2026-07-31", nil), userID)
	getW := httptest.NewRecorder()
	h.Get(getW, getReq)
	if getW.Code != http.StatusOK {
		t.Fatalf("GET: expected 200, got %d: %s", getW.Code, getW.Body.String())
	}

	var sessions []struct {
		ID      string `json:"id"`
		Entries []struct {
			RawText string `json:"rawText"`
		} `json:"entries"`
	}
	json.Unmarshal(getW.Body.Bytes(), &sessions)
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d: %s", len(sessions), getW.Body.String())
	}
	if len(sessions[0].Entries) != 1 || sessions[0].Entries[0].RawText != "squat" {
		t.Fatalf("expected 1 entry with rawText 'squat', got %+v", sessions[0].Entries)
	}

	respBody := getW.Body.String()
	if !strings.Contains(respBody, `"rawText"`) {
		t.Errorf("expected camelCase \"rawText\" in Get response, got %s", respBody)
	}
	if strings.Contains(respBody, `"raw_text"`) || strings.Contains(respBody, `"user_id"`) {
		t.Errorf("expected no snake_case keys in Get response, got %s", respBody)
	}
}
