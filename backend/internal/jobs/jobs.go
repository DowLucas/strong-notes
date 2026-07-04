// Package jobs hosts the River-backed background workers for Scaffold.
//
// River uses Postgres as the queue (no Redis). The client is bootstrapped
// from cmd/api/main.go behind the JOBS_ENABLED config flag. The only resident
// worker today is the async magic-link email sender — a worked example of the
// enqueue-from-handler + worker pattern.
package jobs

import (
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"github.com/DowLucas/strong-notes-backend/internal/email"
)

// New builds a River client wired up with the registered workers. The caller
// owns lifecycle (Start/Stop). Returns nil with a non-nil error on
// misconfiguration so callers can fail-fast at boot.
func New(pool *pgxpool.Pool, workers *river.Workers) (*river.Client[pgx.Tx], error) {
	if pool == nil {
		return nil, fmt.Errorf("jobs.New: pool is nil")
	}
	if workers == nil {
		return nil, fmt.Errorf("jobs.New: workers is nil")
	}
	client, err := river.NewClient(riverpgxv5.New(pool), &river.Config{
		Queues: map[string]river.QueueConfig{
			river.QueueDefault: {MaxWorkers: 10},
		},
		Workers: workers,
	})
	if err != nil {
		return nil, fmt.Errorf("jobs.New: %w", err)
	}
	return client, nil
}

// RegisterWorkers attaches every worker to a fresh Workers bundle. Split out
// so tests can build the bundle independently.
func RegisterWorkers(sender email.Sender) *river.Workers {
	workers := river.NewWorkers()
	river.AddWorker(workers, &SendMagicLinkEmailWorker{Sender: sender})
	return workers
}
