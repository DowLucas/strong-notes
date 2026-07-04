//go:build integration

package handler_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/DowLucas/strong-notes-backend/internal/auth"
	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/email"
	"github.com/DowLucas/strong-notes-backend/internal/handler"
	"github.com/DowLucas/strong-notes-backend/internal/server"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
	"github.com/DowLucas/strong-notes-backend/testutil"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var emailCounter int

func uniqueEmail(t *testing.T, prefix string) string {
	t.Helper()
	emailCounter++
	return fmt.Sprintf("%s%d@example.com", prefix, emailCounter)
}

func newAuthEnv(t *testing.T) *testutil.Env {
	t.Helper()
	env := testutil.NewEnv(t)
	env.Config.DevMode = true // surface magic-link token in response
	env.Config.MagicLinkTTL = 15 * time.Minute
	env.Router = server.New(env.Config, env.Pool, env.Queries, env.JWT, nil, nil)
	return env
}

func mustReq(t *testing.T, method, path, body string) *http.Request {
	t.Helper()
	req, err := http.NewRequest(method, path, strings.NewReader(body))
	require.NoError(t, err)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	return req
}

// New users created via magic-link verify must NOT get a derived display_name.
// The display_name must be empty so the client can require onboarding to capture
// a full name.
func TestVerify_NewUserHasEmptyDisplayName(t *testing.T) {
	env := newAuthEnv(t)
	email := uniqueEmail(t, "newuser")

	rr := env.Do(t, mustReq(t, "POST", "/api/auth/magic-link", `{"email":"`+email+`"}`))
	require.Equal(t, http.StatusOK, rr.Code)

	var mlResp struct {
		Token string `json:"token"`
	}
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&mlResp))
	require.NotEmpty(t, mlResp.Token, "dev mode should return token")

	rr = env.Do(t, mustReq(t, "POST", "/api/auth/verify", `{"token":"`+mlResp.Token+`"}`))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())

	var verifyResp struct {
		Token string `json:"token"`
		User  struct {
			Name  string `json:"name"`
			Email string `json:"email"`
		} `json:"user"`
	}
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&verifyResp))
	assert.Equal(t, "", verifyResp.User.Name, "new user must have empty name until onboarding sets one")
	assert.Equal(t, email, verifyResp.User.Email)
}

func TestUpdateMe_SetsFullName(t *testing.T) {
	env := newAuthEnv(t)
	user := testutil.CreateUser(t, env.Pool, uniqueEmail(t, "u"), "")
	token := env.MintToken(t, user.ID, user.Email)

	rr := env.Do(t, env.AuthRequest(t, "PATCH", "/api/me", `{"name":"Alice Andersson"}`, token))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())

	var resp struct {
		Name string `json:"name"`
	}
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Equal(t, "Alice Andersson", resp.Name)

	q := db.New(env.Pool)
	got, err := q.GetUserByID(context.Background(), user.ID)
	require.NoError(t, err)
	assert.Equal(t, "Alice Andersson", got.DisplayName)
}

func TestUpdateMe_RejectsBlank(t *testing.T) {
	env := newAuthEnv(t)
	user := testutil.CreateUser(t, env.Pool, uniqueEmail(t, "u"), "")
	token := env.MintToken(t, user.ID, user.Email)

	for _, body := range []string{`{"name":""}`, `{"name":"   "}`, `{"name":"\t\n"}`} {
		rr := env.Do(t, env.AuthRequest(t, "PATCH", "/api/me", body, token))
		assert.Equal(t, http.StatusBadRequest, rr.Code, "body=%s", body)
	}
}

func TestUpdateMe_TrimsWhitespace(t *testing.T) {
	env := newAuthEnv(t)
	user := testutil.CreateUser(t, env.Pool, uniqueEmail(t, "u"), "")
	token := env.MintToken(t, user.ID, user.Email)

	rr := env.Do(t, env.AuthRequest(t, "PATCH", "/api/me", `{"name":"  Bob Berg  "}`, token))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())

	var resp struct {
		Name string `json:"name"`
	}
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Equal(t, "Bob Berg", resp.Name)
}

func TestUpdateMe_SetsPhone(t *testing.T) {
	env := newAuthEnv(t)
	user := testutil.CreateUser(t, env.Pool, uniqueEmail(t, "u"), "Carl")
	token := env.MintToken(t, user.ID, user.Email)

	rr := env.Do(t, env.AuthRequest(t, "PATCH", "/api/me", `{"phone":"+46 70 123 45 67"}`, token))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())

	var resp struct {
		Phone string `json:"phone"`
		Name  string `json:"name"`
	}
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Equal(t, "+46 70 123 45 67", resp.Phone)
	assert.Equal(t, "Carl", resp.Name, "name must be preserved when only phone is sent")
}

func TestUpdateMe_RejectsBlankPhone(t *testing.T) {
	env := newAuthEnv(t)
	user := testutil.CreateUser(t, env.Pool, uniqueEmail(t, "u"), "Carl")
	token := env.MintToken(t, user.ID, user.Email)

	rr := env.Do(t, env.AuthRequest(t, "PATCH", "/api/me", `{"phone":"   "}`, token))
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

// Me returns the authenticated user; a missing token is rejected.
func TestMe_RequiresAuth(t *testing.T) {
	env := newAuthEnv(t)
	rr := env.Do(t, mustReq(t, "GET", "/api/me", ""))
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestMe_ReturnsUser(t *testing.T) {
	env := newAuthEnv(t)
	user := testutil.CreateUser(t, env.Pool, uniqueEmail(t, "me"), "Dana")
	token := env.MintToken(t, user.ID, user.Email)

	rr := env.Do(t, env.AuthRequest(t, "GET", "/api/me", "", token))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())

	var resp struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Equal(t, user.ID, resp.ID)
	assert.Equal(t, "Dana", resp.Name)
}

// DeleteMe soft-deletes the user; afterwards the same token must stop working.
func TestDeleteMe_SoftDeletesAndInvalidatesToken(t *testing.T) {
	env := newAuthEnv(t)
	user := testutil.CreateUser(t, env.Pool, uniqueEmail(t, "del"), "Erik")
	token := env.MintToken(t, user.ID, user.Email)

	rr := env.Do(t, env.AuthRequest(t, "DELETE", "/api/me", "", token))
	require.Equal(t, http.StatusNoContent, rr.Code, rr.Body.String())

	// The (still-unexpired) JWT must now be rejected by the deleted-user check.
	rr = env.Do(t, env.AuthRequest(t, "GET", "/api/me", "", token))
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

// Logout is advisory (JWT stays valid until expiry). The handler does nothing
// today but must respond 204 to keep the app's contract stable.
func TestLogout_Returns204WithValidToken(t *testing.T) {
	env := newAuthEnv(t)
	user := testutil.CreateUser(t, env.Pool, uniqueEmail(t, "logout"), "Logout User")
	token := env.MintToken(t, user.ID, user.Email)

	rr := env.Do(t, env.AuthRequest(t, "POST", "/api/me/logout", "", token))
	assert.Equal(t, http.StatusNoContent, rr.Code, rr.Body.String())
}

func TestLogout_RequiresAuth(t *testing.T) {
	env := newAuthEnv(t)
	rr := env.Do(t, mustReq(t, "POST", "/api/me/logout", ""))
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

// Two concurrent verifies of the same magic-link token must result in exactly
// one 200 and one 400 — the UPDATE … RETURNING consume is atomic.
func TestVerify_ConcurrentSameToken_ExactlyOneWins(t *testing.T) {
	env := newAuthEnv(t)
	email := uniqueEmail(t, "concurrent")

	rr := env.Do(t, mustReq(t, "POST", "/api/auth/magic-link", `{"email":"`+email+`"}`))
	require.Equal(t, http.StatusOK, rr.Code)
	var ml struct {
		Token string `json:"token"`
	}
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&ml))
	require.NotEmpty(t, ml.Token)

	body := `{"token":"` + ml.Token + `"}`
	results := make([]int, 2)
	var wg sync.WaitGroup
	wg.Add(2)
	for i := range results {
		go func(idx int) {
			defer wg.Done()
			req := mustReq(t, "POST", "/api/auth/verify", body)
			rr := httptest.NewRecorder()
			env.Router.ServeHTTP(rr, req)
			results[idx] = rr.Code
		}(i)
	}
	wg.Wait()

	successes, failures := 0, 0
	for _, code := range results {
		switch code {
		case http.StatusOK:
			successes++
		case http.StatusBadRequest, http.StatusUnauthorized:
			failures++
		}
	}
	assert.Equal(t, 1, successes, "exactly one verify must succeed; got codes %v", results)
	assert.Equal(t, 1, failures, "exactly one verify must fail; got codes %v", results)
}

func TestVerify_ExpiredToken_Returns400(t *testing.T) {
	env := newAuthEnv(t)
	raw, err := auth.GenerateToken()
	require.NoError(t, err)
	hash := auth.HashToken(raw)

	_, err = env.Queries.CreateMagicLinkToken(context.Background(), db.CreateMagicLinkTokenParams{
		ID:        ulid.New(),
		TokenHash: hash,
		TokenType: "magic_link",
		Email:     uniqueEmail(t, "expired"),
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Minute), Valid: true},
	})
	require.NoError(t, err)

	rr := env.Do(t, mustReq(t, "POST", "/api/auth/verify", `{"token":"`+raw+`"}`))
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

// magicLinkRouter mounts a fresh AuthHandler.MagicLink wired to the given
// email.Sender so the test can inject a fake sender directly (server.New
// constructs the sender from cfg internally). jobs are disabled so the email
// goes through the inline send path.
func magicLinkRouter(t *testing.T, env *testutil.Env, sender email.Sender) http.Handler {
	t.Helper()
	h := handler.NewAuthHandler(env.Pool, env.Queries, env.Config, env.JWT, sender, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/magic-link", h.MagicLink)
	return mux
}

// Posting a magic-link request must invoke the configured Sender exactly once
// with the requested email and a body containing the verify link.
func TestMagicLink_SendsEmailViaSender(t *testing.T) {
	env := newAuthEnv(t)
	fake := &email.FakeSender{}
	router := magicLinkRouter(t, env, fake)

	addr := uniqueEmail(t, "mail")
	req := mustReq(t, "POST", "/api/auth/magic-link", `{"email":"`+addr+`"}`)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())

	require.Len(t, fake.Messages, 1, "expected exactly one email sent")
	msg := fake.Messages[0]
	assert.Equal(t, addr, msg.To)
	assert.NotEmpty(t, msg.Subject)
	assert.Contains(t, msg.TextBody, "/api/auth/verify?token=", "text body should contain verify link")
	assert.Contains(t, msg.HTMLBody, "/api/auth/verify?token=", "html body should contain verify link")
	assert.Contains(t, msg.TextBody, "15 minutes", "TTL should be interpolated from cfg.MagicLinkTTL")
}

// Even when the Sender errors, the magic link is still minted and the response
// stays 200 OK (dev mode also returns the link so the client can recover).
func TestMagicLink_SendFailureDoesNotBreakResponse(t *testing.T) {
	env := newAuthEnv(t)
	fake := &email.FakeSender{Err: errors.New("smtp down")}
	router := magicLinkRouter(t, env, fake)

	addr := uniqueEmail(t, "mailfail")
	req := mustReq(t, "POST", "/api/auth/magic-link", `{"email":"`+addr+`"}`)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())

	var resp struct {
		OK    bool   `json:"ok"`
		Token string `json:"token"`
		Link  string `json:"link"`
	}
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.True(t, resp.OK)
	assert.NotEmpty(t, resp.Token, "dev mode must still surface the token even when send fails")
	assert.Contains(t, resp.Link, "/api/auth/verify?token=")
	require.Len(t, fake.Messages, 1, "send was still attempted before erroring")
}

// Addresses on the DemoLoginEmails allowlist must receive the magic-link token
// inline even when DevMode is OFF (hosted mode), so app-store reviewers can
// sign in without inbox access. Non-allowlisted addresses must never leak it.
func TestMagicLink_DemoEmailReturnsTokenInline(t *testing.T) {
	env := newAuthEnv(t)
	env.Config.DevMode = false // hosted-mode behaviour: no blanket token leak
	demo := "appstore-review@scaffold.app"
	env.Config.DemoLoginEmails = []string{demo}

	fake := &email.FakeSender{}
	router := magicLinkRouter(t, env, fake)

	// Allowlisted demo email (mixed case) → token surfaced inline.
	req := mustReq(t, "POST", "/api/auth/magic-link", `{"email":"AppStore-Review@Scaffold.app"}`)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())

	var resp struct {
		OK    bool   `json:"ok"`
		Token string `json:"token"`
		Link  string `json:"link"`
	}
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.True(t, resp.OK)
	assert.NotEmpty(t, resp.Token, "demo email must surface token inline with DevMode off")
	assert.Contains(t, resp.Link, "/api/auth/verify?token=")

	// Ordinary address → token must stay server-side.
	other := uniqueEmail(t, "notdemo")
	req2 := mustReq(t, "POST", "/api/auth/magic-link", `{"email":"`+other+`"}`)
	rr2 := httptest.NewRecorder()
	router.ServeHTTP(rr2, req2)
	require.Equal(t, http.StatusOK, rr2.Code, rr2.Body.String())

	var resp2 struct {
		Token string `json:"token"`
	}
	require.NoError(t, json.NewDecoder(rr2.Body).Decode(&resp2))
	assert.Empty(t, resp2.Token, "non-demo email must NOT leak token when DevMode off")
}
