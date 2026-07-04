package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/DowLucas/strong-notes-backend/internal/auth"
	"github.com/DowLucas/strong-notes-backend/internal/config"
	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/email"
	"github.com/DowLucas/strong-notes-backend/internal/jobs"
	"github.com/DowLucas/strong-notes-backend/internal/middleware"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
)

// authMaxBodyBytes caps every auth-handler request body. 64 KiB is far above
// any legitimate payload and well below an amplification attack.
const authMaxBodyBytes = 64 << 10

// EmailEnqueuer is the subset of the River client the auth handler needs to
// enqueue the async magic-link email job. The concrete *river.Client[pgx.Tx]
// satisfies it. nil means "no job queue" → send the email inline.
type EmailEnqueuer interface {
	Insert(ctx context.Context, args river.JobArgs, opts *river.InsertOpts) (*rivertype.JobInsertResult, error)
}

type AuthHandler struct {
	pool    *pgxpool.Pool
	queries *db.Queries
	cfg     *config.Config
	jwt     *auth.JWTService
	sender  email.Sender
	jobs    EmailEnqueuer // optional; when nil, emails are sent inline
}

// redactEmail produces a structured-log-safe email fingerprint: first
// character + asterisks + "@" + domain. Never log the full address.
func redactEmail(email string) string {
	at := strings.LastIndex(email, "@")
	if at <= 0 {
		return "***"
	}
	local := email[:at]
	domain := email[at:]
	stars := len(local) - 1
	if stars < 1 {
		stars = 1
	}
	return string(local[0]) + strings.Repeat("*", stars) + domain
}

func NewAuthHandler(pool *pgxpool.Pool, queries *db.Queries, cfg *config.Config, jwt *auth.JWTService, sender email.Sender, jobsClient EmailEnqueuer) *AuthHandler {
	if sender == nil {
		// Belt-and-braces: never let a nil sender panic the handler.
		sender = email.NoopSender{}
	}
	return &AuthHandler{pool: pool, queries: queries, cfg: cfg, jwt: jwt, sender: sender, jobs: jobsClient}
}

type magicLinkRequest struct {
	Email string `json:"email"`
}

type magicLinkResponse struct {
	OK    bool   `json:"ok"`
	Token string `json:"token,omitempty"` // only set in dev / demo-login mode
	Link  string `json:"link,omitempty"`  // only set in dev / demo-login mode
}

type verifyRequest struct {
	Token string `json:"token"`
}

type userResponse struct {
	ID              string     `json:"id"`
	Email           string     `json:"email"`
	Name            string     `json:"name"`
	Phone           string     `json:"phone"`
	AvatarObjectURL *string    `json:"avatar_object_url,omitempty"`
	AvatarUpdatedAt *time.Time `json:"avatar_updated_at,omitempty"`
}

type tokenResponse struct {
	Token string       `json:"token"`
	User  userResponse `json:"user"`
}

func userToResponse(u db.User) userResponse {
	r := userResponse{
		ID:    u.ID,
		Email: u.Email,
		Name:  u.DisplayName,
	}
	if u.Phone.Valid {
		r.Phone = u.Phone.String
	}
	if u.AvatarObjectKey.Valid && u.AvatarObjectKey.String != "" {
		v := avatarURL(u.ID)
		r.AvatarObjectURL = &v
	}
	if u.AvatarUpdatedAt.Valid {
		t := u.AvatarUpdatedAt.Time
		r.AvatarUpdatedAt = &t
	}
	return r
}

// MagicLink issues a magic-link token and delivers it by email. In dev mode
// (or for an allowlisted demo-login address) the token is also returned in the
// response body so the client can verify without an inbox.
func (h *AuthHandler) MagicLink(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, authMaxBodyBytes)
	var req magicLinkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	addr := strings.ToLower(strings.TrimSpace(req.Email))
	if _, err := mail.ParseAddress(addr); err != nil {
		writeError(w, http.StatusBadRequest, "invalid email")
		return
	}

	raw, err := auth.GenerateToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}
	hash := auth.HashToken(raw)

	_, err = h.queries.CreateMagicLinkToken(r.Context(), db.CreateMagicLinkTokenParams{
		ID:        ulid.New(),
		TokenHash: hash,
		TokenType: "magic_link",
		Email:     addr,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(h.cfg.MagicLinkTTL), Valid: true},
	})
	if err != nil {
		slog.Error("magic link: failed to create token", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to issue token")
		return
	}

	link := h.cfg.BaseURL + "/api/auth/verify?token=" + raw
	expiryMinutes := int(h.cfg.MagicLinkTTL / time.Minute)
	if expiryMinutes < 1 {
		expiryMinutes = 1
	}

	// Deliver the email. When the background job queue is enabled, enqueue
	// the send so it runs off the request path; otherwise send inline. Send
	// failures never block the response — the token is already minted (and in
	// dev/demo mode also returned inline).
	if h.cfg.JobsEnabled && h.jobs != nil {
		if _, err := h.jobs.Insert(r.Context(), jobs.SendMagicLinkEmailArgs{
			Email:         addr,
			Link:          link,
			ExpiryMinutes: expiryMinutes,
		}, nil); err != nil {
			slog.Error("magic link enqueue failed", "email_hash", redactEmail(addr), "error", err)
		}
	} else {
		textBody, htmlBody := email.MagicLinkBody(link, expiryMinutes)
		if err := h.sender.Send(r.Context(), email.Message{
			To:       addr,
			Subject:  email.MagicLinkSubject,
			TextBody: textBody,
			HTMLBody: htmlBody,
		}); err != nil {
			slog.Error("magic link send failed", "email_hash", redactEmail(addr), "error", err)
		}
	}

	// Surface the token inline for (a) dev mode, or (b) allowlisted demo
	// accounts in any mode — the latter lets app-store reviewers sign into a
	// pre-seeded demo account without inbox access. Scoped to the exact
	// configured addresses; all other addresses get the email-only response.
	if h.cfg.DevMode || h.cfg.IsDemoLogin(addr) {
		slog.Info("magic link issued (inline token)", "email_hash", redactEmail(addr), "dev_mode", h.cfg.DevMode)
		writeJSON(w, http.StatusOK, magicLinkResponse{OK: true, Token: raw, Link: link})
		return
	}
	slog.Info("magic link issued", "email_hash", redactEmail(addr))
	writeJSON(w, http.StatusOK, magicLinkResponse{OK: true})
}

// Verify exchanges a magic-link token for a JWT.
func (h *AuthHandler) Verify(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, authMaxBodyBytes)
	var req verifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Token == "" {
		writeError(w, http.StatusBadRequest, "missing token")
		return
	}
	hash := auth.HashToken(req.Token)

	// Atomic single-use consume — the UPDATE … RETURNING flips used_at and
	// returns the row in one statement, so two concurrent verifies of the
	// same token can never both win. Zero rows = already used, expired, or
	// never existed; all three look the same to the caller.
	row, err := h.queries.ConsumeMagicLinkToken(r.Context(), hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusBadRequest, "invalid or expired token")
			return
		}
		writeError(w, http.StatusInternalServerError, "lookup failed")
		return
	}

	user, err := h.queries.GetUserByEmail(r.Context(), row.Email)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusInternalServerError, "user lookup failed")
			return
		}
		user, err = h.queries.UpsertUser(r.Context(), db.UpsertUserParams{
			ID:          ulid.New(),
			Email:       row.Email,
			DisplayName: "",
			Locale:      "en",
		})
		if err != nil {
			slog.Error("verify: upsert user failed", "error", err)
			writeError(w, http.StatusInternalServerError, "user create failed")
			return
		}
	}

	jwtStr, err := h.jwt.Sign(user.ID, user.Email, h.cfg.InstanceMode)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to sign token")
		return
	}

	writeJSON(w, http.StatusOK, tokenResponse{Token: jwtStr, User: userToResponse(user)})
}

// Logout is an advisory hook. The JWT is stateless and stays valid until
// expiry regardless of this call — the server does nothing today. The endpoint
// exists so the app's contract (best-effort POST on Sign out) stays stable if
// real revocation lands later.
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	if middleware.ClaimsFromContext(r.Context()) == nil {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Me returns the authenticated user.
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	user, err := h.queries.GetActiveUserByID(r.Context(), claims.UserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, "user not found or deleted")
			return
		}
		writeError(w, http.StatusInternalServerError, "lookup failed")
		return
	}
	writeJSON(w, http.StatusOK, userToResponse(user))
}

// DeleteMe soft-deletes the authenticated user (account self-deletion). The
// user row stays, PII is nulled, the email is rewritten to a sentinel, and the
// auth middleware refuses any future request whose JWT references the deleted
// user. Returns 204 on success.
func (h *AuthHandler) DeleteMe(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, authMaxBodyBytes)
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	user, err := h.queries.GetUserByID(r.Context(), claims.UserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, "user not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "lookup failed")
		return
	}
	if user.DeletedAt.Valid {
		writeError(w, http.StatusUnauthorized, "user not found")
		return
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	defer tx.Rollback(r.Context())
	q := db.New(tx)

	// Outstanding magic-link tokens for the original email become irrelevant
	// the moment the email is rewritten to the sentinel, but explicit is
	// cheaper than leaving dead rows in the table.
	if err := q.DeleteMagicLinkTokensByEmail(r.Context(), user.Email); err != nil {
		slog.Error("delete me: magic link wipe failed", "error", err, "user_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "delete failed")
		return
	}

	if err := q.SoftDeleteUser(r.Context(), claims.UserID); err != nil {
		slog.Error("delete me: soft delete failed", "error", err, "user_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "delete failed")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	slog.Info("account self-deleted", "user_id", claims.UserID)
	w.WriteHeader(http.StatusNoContent)
}

type updateMeRequest struct {
	Name  *string `json:"name"`
	Phone *string `json:"phone"`
}

const (
	maxDisplayNameLen = 80
	maxPhoneLen       = 32
)

// UpdateMe updates the authenticated user's profile (display name and/or
// phone).
func (h *AuthHandler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req updateMeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Name == nil && req.Phone == nil {
		writeError(w, http.StatusBadRequest, "no fields to update")
		return
	}

	nameParam := pgtype.Text{}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			writeError(w, http.StatusBadRequest, "name must not be empty")
			return
		}
		if len(name) > maxDisplayNameLen {
			writeError(w, http.StatusBadRequest, "name too long")
			return
		}
		nameParam = pgtype.Text{String: name, Valid: true}
	}

	phoneParam := pgtype.Text{}
	if req.Phone != nil {
		phone := strings.TrimSpace(*req.Phone)
		if phone == "" {
			writeError(w, http.StatusBadRequest, "phone must not be empty")
			return
		}
		if len(phone) > maxPhoneLen {
			writeError(w, http.StatusBadRequest, "phone too long")
			return
		}
		phoneParam = pgtype.Text{String: phone, Valid: true}
	}

	user, err := h.queries.UpdateUser(r.Context(), db.UpdateUserParams{
		ID:          claims.UserID,
		DisplayName: nameParam,
		Phone:       phoneParam,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, "user not found")
			return
		}
		slog.Error("update me: update user failed", "error", err)
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}

	writeJSON(w, http.StatusOK, userToResponse(user))
}
