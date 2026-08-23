package parsing

import (
	"context"

	"github.com/DowLucas/strong-notes-backend/internal/db"
)

// ExerciseNamesByID returns id -> name for the given exercise ids (unknown
// ids are simply absent). Shared by the dictionary resolver and the
// abbreviations handler so both can surface the human name alongside an
// exercise id.
func ExerciseNamesByID(ctx context.Context, q *db.Queries, ids []string) (map[string]string, error) {
	names := make(map[string]string, len(ids))
	if len(ids) == 0 {
		return names, nil
	}
	rows, err := q.GetExerciseNamesByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		names[r.ID] = r.Name
	}
	return names, nil
}
