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

// InsertTestUser inserts a user with a caller-supplied ID, for tests that
// need to reference the user's ID before creating it (e.g. as a foreign key
// on rows created in the same test).
func InsertTestUser(t *testing.T, pool *pgxpool.Pool, userID, email string) db.User {
	t.Helper()
	q := db.New(pool)
	user, err := q.UpsertUser(context.Background(), db.UpsertUserParams{
		ID:          userID,
		Email:       email,
		DisplayName: "",
		AvatarUrl:   nullText(""),
		Locale:      "en",
	})
	require.NoError(t, err)
	return user
}
