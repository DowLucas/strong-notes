package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/coreos/go-oidc/v3/oidc"

	"github.com/DowLucas/strong-notes-backend/internal/auth"
	"github.com/DowLucas/strong-notes-backend/internal/config"
	"github.com/DowLucas/strong-notes-backend/internal/db"
)

const appleIssuer = "https://appleid.apple.com"

// AppleAuthHandler verifies native Sign in with Apple identity tokens and
// exchanges them for the same session JWT the magic-link flow issues. The
// verifier lives on the handler so go-oidc's JWKS cache is reused across
// requests.
type AppleAuthHandler struct {
	queries  *db.Queries
	cfg      *config.Config
	jwt      *auth.JWTService
	verifier *oidc.IDTokenVerifier
}

// NewAppleAuthHandler builds the production handler. It blocks on OIDC
// discovery against Apple, so call it once at boot — never per request.
func NewAppleAuthHandler(ctx context.Context, queries *db.Queries, cfg *config.Config, jwtSvc *auth.JWTService) (*AppleAuthHandler, error) {
	if !cfg.HasApple() {
		return nil, fmt.Errorf("apple auth: APPLE_BUNDLE_ID is empty")
	}
	provider, err := oidc.NewProvider(ctx, appleIssuer)
	if err != nil {
		return nil, fmt.Errorf("apple auth: oidc discovery: %w", err)
	}
	verifier := provider.Verifier(&oidc.Config{
		ClientID:             cfg.AppleBundleID,
		SupportedSigningAlgs: []string{"RS256"},
	})
	return NewAppleAuthHandlerWithVerifier(queries, cfg, jwtSvc, verifier), nil
}

// NewAppleAuthHandlerWithVerifier is NewAppleAuthHandler with a pre-built
// verifier — used by integration tests to trust a locally generated keypair.
func NewAppleAuthHandlerWithVerifier(queries *db.Queries, cfg *config.Config, jwtSvc *auth.JWTService, verifier *oidc.IDTokenVerifier) *AppleAuthHandler {
	return &AppleAuthHandler{queries: queries, cfg: cfg, jwt: jwtSvc, verifier: verifier}
}

type appleNativeRequest struct {
	IdentityToken string `json:"identity_token"`
	// Name is the user's full name as reported by Apple. Apple only sends it
	// on the very first authorization, and we only persist it on first
	// sign-in; later values are ignored.
	Name string `json:"name"`
	// Nonce is the raw nonce the client generated and passed to Apple. The
	// id_token's nonce claim is SHA-256(nonce) as hex — we recompute and
	// compare, so a token minted for a different request can't be replayed.
	Nonce string `json:"nonce"`
}

// appleClaims is the subset of the identity token we read. email_verified is
// sometimes a JSON bool and sometimes the string "true"; RawMessage handles
// both.
type appleClaims struct {
	Email         string          `json:"email"`
	EmailVerified json.RawMessage `json:"email_verified"`
	Sub           string          `json:"sub"`
	Nonce         string          `json:"nonce"`
}

func (c appleClaims) emailIsVerified() bool {
	s := strings.TrimSpace(string(c.EmailVerified))
	return s == "true" || s == `"true"`
}

// Native verifies an Apple identity token, looks up or creates the user
// (capturing the optional first-sign-in name), and responds exactly like
// /api/auth/verify so the mobile client treats both flows identically.
func (h *AppleAuthHandler) Native(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, authMaxBodyBytes)
	var req appleNativeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if strings.TrimSpace(req.Nonce) == "" {
		writeError(w, http.StatusBadRequest, "missing nonce")
		return
	}
	if strings.TrimSpace(req.IdentityToken) == "" {
		writeError(w, http.StatusUnauthorized, "invalid apple token")
		return
	}

	idToken, err := h.verifier.Verify(r.Context(), req.IdentityToken)
	if err != nil {
		slog.Warn("apple auth: verify failed", "error", err)
		writeError(w, http.StatusUnauthorized, "invalid apple token")
		return
	}
	var claims appleClaims
	if err := idToken.Claims(&claims); err != nil {
		slog.Warn("apple auth: claims decode failed", "error", err)
		writeError(w, http.StatusUnauthorized, "invalid apple token")
		return
	}

	expected := sha256.Sum256([]byte(req.Nonce))
	if hex.EncodeToString(expected[:]) != claims.Nonce {
		slog.Warn("apple auth: nonce mismatch")
		writeError(w, http.StatusUnauthorized, "invalid apple token")
		return
	}

	email := strings.ToLower(strings.TrimSpace(claims.Email))
	if email == "" || !claims.emailIsVerified() {
		slog.Warn("apple auth: email missing or unverified", "has_email", email != "")
		writeError(w, http.StatusUnauthorized, "invalid apple token")
		return
	}
	if claims.Sub == "" {
		// Apple always sends sub; warn but don't reject — email is the join key.
		slog.Warn("apple auth: missing sub claim", "email_hash", redactEmail(email))
	}

	displayName := truncateUTF8(strings.TrimSpace(req.Name), maxDisplayNameLen)
	user, ok := lookupOrCreateUser(w, r, h.queries, email, displayName)
	if !ok {
		return
	}
	writeSessionToken(w, h.jwt, h.cfg, user)
}

// truncateUTF8 cuts s to at most max bytes without splitting a multi-byte
// rune (Postgres rejects invalid UTF-8 in TEXT columns).
func truncateUTF8(s string, max int) string {
	if len(s) <= max {
		return s
	}
	cut := max
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut]
}
