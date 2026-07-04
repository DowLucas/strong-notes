//go:build integration

package testutil

import (
	"context"
	"testing"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/ulid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// CreateUser inserts a user and returns it.
func CreateUser(t *testing.T, pool *pgxpool.Pool, email, displayName string) db.User {
	t.Helper()
	q := db.New(pool)
	user, err := q.UpsertUser(context.Background(), db.UpsertUserParams{
		ID:          ulid.New(),
		Email:       email,
		DisplayName: displayName,
		AvatarUrl:   nullText(""),
		Locale:      "en",
	})
	require.NoError(t, err)
	return user
}
