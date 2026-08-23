package server

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/DowLucas/strong-notes-backend/internal/auth"
	"github.com/DowLucas/strong-notes-backend/internal/config"
	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/email"
	"github.com/DowLucas/strong-notes-backend/internal/handler"
	"github.com/DowLucas/strong-notes-backend/internal/llm"
	"github.com/DowLucas/strong-notes-backend/internal/middleware"
	"github.com/DowLucas/strong-notes-backend/internal/storage"
	"github.com/DowLucas/strong-notes-backend/internal/wellknown"
)

const version = "0.1.0"

// New builds the HTTP router. store may be nil (avatar routes are skipped) and
// jobsClient may be nil (magic-link emails are sent inline).
func New(cfg *config.Config, pool *pgxpool.Pool, queries *db.Queries, jwtSvc *auth.JWTService, store *storage.Client, jobsClient handler.EmailEnqueuer) http.Handler {
	r := chi.NewRouter()

	// RealIP: only honor X-Forwarded-For / X-Real-IP when the immediate
	// peer is in TRUSTED_PROXIES. Default (empty allowlist) ignores these
	// headers — otherwise per-IP rate limits are trivial to bypass by
	// spoofing XFF on a direct connection.
	r.Use(middleware.TrustedProxyRealIP(middleware.ParseTrustedCIDRs(cfg.TrustedProxies)))
	r.Use(chimiddleware.RequestID)
	// RequestLogger scrubs ?token=… / ?code=… / ?access_token=… from the
	// logged URL. Chi's default Logger would log the magic-link verify URL
	// verbatim (a GET click 404s, but the token is captured in the access
	// log before the 404).
	r.Use(middleware.RequestLogger)
	r.Use(chimiddleware.Recoverer)
	r.Use(middleware.SecurityHeaders())
	r.Use(corsMiddleware)
	r.Use(chimiddleware.Compress(5))

	healthH := handler.NewHealthHandler(pool)
	emailSender := email.NewSenderFromConfig(cfg)
	authH := handler.NewAuthHandler(pool, queries, cfg, jwtSvc, emailSender, jobsClient)

	r.Get("/.well-known/scaffold-instance", wellknown.Handler(cfg, version, store != nil))

	r.Get("/api/health/liveness", healthH.Liveness)
	r.Get("/api/health/readiness", healthH.Readiness)

	r.Group(func(r chi.Router) {
		r.Use(middleware.AuthRateLimit(30, 5))
		r.Post("/api/auth/magic-link", authH.MagicLink)
		r.Post("/api/auth/verify", authH.Verify)

		// Native Sign in with Apple only mounts when APPLE_BUNDLE_ID is set.
		// Discovery failure is logged, not fatal: a blip at Apple's JWKS
		// endpoint must never keep the whole API from booting.
		if cfg.HasApple() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			appleH, err := handler.NewAppleAuthHandler(ctx, queries, cfg, jwtSvc)
			if err != nil {
				slog.Error("apple auth: disabled, failed to init handler", "error", err)
			} else {
				r.Post("/api/auth/apple/native", appleH.Native)
				slog.Info("apple auth: enabled", "bundle_id", cfg.AppleBundleID)
			}
		} else {
			slog.Info("apple auth: disabled (APPLE_BUNDLE_ID not set)")
		}
	})

	// Authenticated routes. The protocol-version middleware runs here (not on
	// /.well-known/* or /api/health/*) so out-of-range clients can still read
	// the current min/max and recover.
	r.Group(func(r chi.Router) {
		r.Use(middleware.ProtocolVersion(cfg.MinAppProtocol, cfg.MaxAppProtocol))
		r.Use(middleware.Authenticate(jwtSvc, queries))

		r.Get("/api/me", authH.Me)
		r.Patch("/api/me", authH.UpdateMe)
		r.Delete("/api/me", authH.DeleteMe)
		r.Post("/api/me/logout", authH.Logout)

		llmProvider, err := llm.NewProvider(cfg)
		if err != nil {
			panic(fmt.Sprintf("llm.NewProvider: %v", err)) // fail fast at startup, not per-request
		}
		resolveH := handler.NewResolveHandler(queries, llmProvider)
		r.Post("/api/resolve/line", resolveH.ResolveLine)
		r.Post("/api/resolve/goal", resolveH.ResolveGoal)

		exercisesH := handler.NewExercisesHandler(queries)
		r.Post("/api/exercises", exercisesH.Create)

		abbreviationsH := handler.NewAbbreviationsHandler(queries)
		r.Get("/api/abbreviations", abbreviationsH.List)
		r.Post("/api/abbreviations", abbreviationsH.Create)
		r.Patch("/api/abbreviations/{id}/confirm", abbreviationsH.Confirm)

		sessionsH := handler.NewSessionsHandler(pool, queries)
		r.Get("/api/sessions", sessionsH.Get)
		r.Put("/api/sessions/{date}", sessionsH.Put)

		goalsH := handler.NewGoalsHandler(pool, queries)
		r.Post("/api/goals", goalsH.Create)
		r.Get("/api/goals/active", goalsH.GetActive)
		r.Get("/api/goals/active/progress", goalsH.GetActiveProgress)

		// Avatar routes only mount when object storage is configured.
		// Without it, the upload endpoint would 500 on every call; better to
		// surface a clean 404 so the client can hide the affordance.
		if store != nil {
			avatarH := handler.NewAvatarHandler(pool, queries, store)
			r.Post("/api/me/avatar", avatarH.Upload)
			r.Delete("/api/me/avatar", avatarH.Delete)
			r.Get("/api/users/{userID}/avatar", avatarH.Get)
		}
	})

	return r
}

// defaultCORSAllowedOrigins is the fallback when ALLOWED_CORS_ORIGINS is unset
// or empty. Covers the Expo dev server on its two default web ports.
var defaultCORSAllowedOrigins = []string{
	"http://localhost:8081",
	"http://localhost:19006",
}

func allowedCORSOrigins() map[string]struct{} {
	raw := strings.TrimSpace(os.Getenv("ALLOWED_CORS_ORIGINS"))
	out := map[string]struct{}{}
	if raw == "" {
		for _, o := range defaultCORSAllowedOrigins {
			out[o] = struct{}{}
		}
		return out
	}
	for _, part := range strings.Split(raw, ",") {
		if s := strings.TrimSpace(part); s != "" {
			out[s] = struct{}{}
		}
	}
	return out
}

func corsMiddleware(next http.Handler) http.Handler {
	allowed := allowedCORSOrigins()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Vary: Origin is set unconditionally so caches don't conflate
		// responses for different origins, regardless of allowlist outcome.
		w.Header().Add("Vary", "Origin")

		origin := r.Header.Get("Origin")
		if origin != "" {
			if _, ok := allowed[origin]; ok {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Scaffold-App-Protocol")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Max-Age", "300")
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
