//go:build integration

package handler_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/DowLucas/strong-notes-backend/internal/handler"
	"github.com/DowLucas/strong-notes-backend/internal/server"
	"github.com/DowLucas/strong-notes-backend/testutil"
)

const (
	testAppleIssuer   = "https://appleid.apple.com"
	testAppleBundleID = "com.dowlucas.strongnotes"

	// testAppleNonce is the raw client-side nonce. Apple's id_token.nonce
	// claim carries SHA-256(testAppleNonce) as hex.
	testAppleNonce = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
)

// appleTestRig holds a generated RSA keypair served as a JWKS document and an
// oidc.IDTokenVerifier wired to trust it, so tests can mint "Apple" tokens
// without touching Apple.
type appleTestRig struct {
	key      *rsa.PrivateKey
	kid      string
	verifier *oidc.IDTokenVerifier
}

func newAppleTestRig(t *testing.T, audience string) *appleTestRig {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	kid := "test-key-1"

	jwks := map[string]any{
		"keys": []map[string]any{{
			"kty": "RSA",
			"alg": "RS256",
			"use": "sig",
			"kid": kid,
			"n":   base64.RawURLEncoding.EncodeToString(key.PublicKey.N.Bytes()),
			"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.PublicKey.E)).Bytes()),
		}},
	}
	jwksJSON, err := json.Marshal(jwks)
	require.NoError(t, err)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(jwksJSON)
	}))
	t.Cleanup(srv.Close)

	keySet := oidc.NewRemoteKeySet(context.Background(), srv.URL)
	verifier := oidc.NewVerifier(testAppleIssuer, keySet, &oidc.Config{
		ClientID:             audience,
		SupportedSigningAlgs: []string{"RS256"},
	})
	return &appleTestRig{key: key, kid: kid, verifier: verifier}
}

func (r *appleTestRig) signToken(t *testing.T, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = r.kid
	signed, err := tok.SignedString(r.key)
	require.NoError(t, err)
	return signed
}

func testAppleNonceHash() string {
	sum := sha256.Sum256([]byte(testAppleNonce))
	return hex.EncodeToString(sum[:])
}

func validAppleClaims(audience, email, sub string) jwt.MapClaims {
	return jwt.MapClaims{
		"iss":            testAppleIssuer,
		"aud":            audience,
		"sub":            sub,
		"email":          email,
		"email_verified": true,
		"nonce":          testAppleNonceHash(),
		"iat":            time.Now().Unix(),
		"exp":            time.Now().Add(10 * time.Minute).Unix(),
	}
}

// newAppleEnv builds the normal router (Apple disabled — no bundle ID, so
// server.New never reaches out to Apple) and mounts the Apple handler on top
// with the rig's verifier injected.
func newAppleEnv(t *testing.T) (*testutil.Env, *appleTestRig) {
	t.Helper()
	env := testutil.NewEnv(t)
	rig := newAppleTestRig(t, testAppleBundleID)

	base := server.New(env.Config, env.Pool, env.Queries, env.JWT, nil, nil)
	appleH := handler.NewAppleAuthHandlerWithVerifier(env.Queries, env.Config, env.JWT, rig.verifier)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/apple/native", appleH.Native)
	mux.Handle("/", base)
	env.Router = mux
	return env, rig
}

func postApple(t *testing.T, env *testutil.Env, body string) *httptest.ResponseRecorder {
	t.Helper()
	return env.Do(t, mustReq(t, "POST", "/api/auth/apple/native", body))
}

func appleBody(token, name, nonce string) string {
	return fmt.Sprintf(`{"identity_token":%q,"name":%q,"nonce":%q}`, token, name, nonce)
}

type appleTokenResponse struct {
	Token string `json:"token"`
	User  struct {
		ID    string `json:"id"`
		Email string `json:"email"`
		Name  string `json:"name"`
	} `json:"user"`
}

func decodeAppleResponse(t *testing.T, rr *httptest.ResponseRecorder) appleTokenResponse {
	t.Helper()
	var out appleTokenResponse
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&out))
	return out
}

func TestAppleNative_NewUserCreatedWithEmptyName(t *testing.T) {
	env, rig := newAppleEnv(t)
	email := uniqueEmail(t, "applenew")
	token := rig.signToken(t, validAppleClaims(testAppleBundleID, email, "apple-sub-1"))

	rr := postApple(t, env, appleBody(token, "", testAppleNonce))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())

	out := decodeAppleResponse(t, rr)
	assert.NotEmpty(t, out.Token)
	assert.NotEmpty(t, out.User.ID)
	assert.Equal(t, email, out.User.Email)
	assert.Equal(t, "", out.User.Name)

	// The issued token is a real session: /api/me must accept it.
	me := env.Do(t, env.AuthRequest(t, "GET", "/api/me", "", out.Token))
	assert.Equal(t, http.StatusOK, me.Code, me.Body.String())
}

func TestAppleNative_NewUserCapturesNameOnFirstSignIn(t *testing.T) {
	env, rig := newAppleEnv(t)
	email := uniqueEmail(t, "applename")
	token := rig.signToken(t, validAppleClaims(testAppleBundleID, email, "apple-sub-2"))

	rr := postApple(t, env, appleBody(token, "  Apple User  ", testAppleNonce))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.Equal(t, "Apple User", decodeAppleResponse(t, rr).User.Name)
}

func TestAppleNative_NameIsTruncated(t *testing.T) {
	env, rig := newAppleEnv(t)
	email := uniqueEmail(t, "applelong")
	token := rig.signToken(t, validAppleClaims(testAppleBundleID, email, "apple-sub-long"))

	long := strings.Repeat("a", 200)
	rr := postApple(t, env, appleBody(token, long, testAppleNonce))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.Len(t, decodeAppleResponse(t, rr).User.Name, 80)
}

func TestAppleNative_ExistingUserDoesNotOverwriteName(t *testing.T) {
	env, rig := newAppleEnv(t)
	email := uniqueEmail(t, "appleexist")
	testutil.CreateUser(t, env.Pool, email, "Already Set")

	token := rig.signToken(t, validAppleClaims(testAppleBundleID, email, "apple-sub-3"))
	rr := postApple(t, env, appleBody(token, "Should Be Ignored", testAppleNonce))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.Equal(t, "Already Set", decodeAppleResponse(t, rr).User.Name)
}

func TestAppleNative_EmailIsLowercased(t *testing.T) {
	env, rig := newAppleEnv(t)
	email := uniqueEmail(t, "applecase")
	upper := strings.ToUpper(email)
	token := rig.signToken(t, validAppleClaims(testAppleBundleID, upper, "apple-sub-case"))

	rr := postApple(t, env, appleBody(token, "", testAppleNonce))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.Equal(t, email, decodeAppleResponse(t, rr).User.Email)
}

func TestAppleNative_EmailVerifiedAsString(t *testing.T) {
	env, rig := newAppleEnv(t)
	email := uniqueEmail(t, "applestr")
	claims := validAppleClaims(testAppleBundleID, email, "apple-sub-str")
	claims["email_verified"] = "true"
	token := rig.signToken(t, claims)

	rr := postApple(t, env, appleBody(token, "", testAppleNonce))
	assert.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
}

func TestAppleNative_UnverifiedEmail_Returns401(t *testing.T) {
	env, rig := newAppleEnv(t)
	email := uniqueEmail(t, "appleunver")
	claims := validAppleClaims(testAppleBundleID, email, "apple-sub-unver")
	claims["email_verified"] = false
	token := rig.signToken(t, claims)

	rr := postApple(t, env, appleBody(token, "", testAppleNonce))
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAppleNative_MissingEmail_Returns401(t *testing.T) {
	env, rig := newAppleEnv(t)
	claims := validAppleClaims(testAppleBundleID, "", "apple-sub-noemail")
	delete(claims, "email")
	token := rig.signToken(t, claims)

	rr := postApple(t, env, appleBody(token, "", testAppleNonce))
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAppleNative_InvalidToken_Returns401(t *testing.T) {
	env, _ := newAppleEnv(t)
	rr := postApple(t, env, appleBody("not-a-real-jwt", "", testAppleNonce))
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAppleNative_EmptyToken_Returns401(t *testing.T) {
	env, _ := newAppleEnv(t)
	rr := postApple(t, env, appleBody("", "", testAppleNonce))
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAppleNative_ExpiredToken_Returns401(t *testing.T) {
	env, rig := newAppleEnv(t)
	email := uniqueEmail(t, "appleexp")
	claims := validAppleClaims(testAppleBundleID, email, "apple-sub-exp")
	claims["exp"] = time.Now().Add(-time.Hour).Unix()
	token := rig.signToken(t, claims)

	rr := postApple(t, env, appleBody(token, "", testAppleNonce))
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAppleNative_WrongAudience_Returns401(t *testing.T) {
	env, rig := newAppleEnv(t)
	email := uniqueEmail(t, "appleaud")
	token := rig.signToken(t, validAppleClaims("some.other.app", email, "apple-sub-4"))

	rr := postApple(t, env, appleBody(token, "", testAppleNonce))
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAppleNative_MissingNonce_Returns400(t *testing.T) {
	env, rig := newAppleEnv(t)
	email := uniqueEmail(t, "applenonce")
	token := rig.signToken(t, validAppleClaims(testAppleBundleID, email, "apple-sub-nonce-missing"))

	rr := postApple(t, env, fmt.Sprintf(`{"identity_token":%q}`, token))
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestAppleNative_MismatchedNonce_Returns401(t *testing.T) {
	env, rig := newAppleEnv(t)
	email := uniqueEmail(t, "applewrongnonce")
	token := rig.signToken(t, validAppleClaims(testAppleBundleID, email, "apple-sub-nonce-bad"))

	rr := postApple(t, env, appleBody(token, "", "different-nonce-than-the-one-baked-in"))
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAppleNative_InvalidJSON_Returns400(t *testing.T) {
	env, _ := newAppleEnv(t)
	rr := postApple(t, env, `{not json`)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestAppleNative_NotMountedWhenBundleIDUnset(t *testing.T) {
	env := testutil.NewEnv(t)
	env.Config.AppleBundleID = ""
	env.Router = server.New(env.Config, env.Pool, env.Queries, env.JWT, nil, nil)

	rr := env.Do(t, mustReq(t, "POST", "/api/auth/apple/native", `{"identity_token":"x","nonce":"y"}`))
	assert.Equal(t, http.StatusNotFound, rr.Code)
}
