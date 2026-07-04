package jobs

import (
	"context"
	"fmt"

	"github.com/riverqueue/river"

	"github.com/DowLucas/strong-notes-backend/internal/email"
)

// SendMagicLinkEmailArgs is the payload for one async magic-link email send.
// The auth handler enqueues this when JOBS_ENABLED is set, instead of sending
// the email inline on the request path. This is the worked example of the
// enqueue-from-handler → background-worker pattern.
type SendMagicLinkEmailArgs struct {
	Email         string `json:"email"`
	Link          string `json:"link"`
	ExpiryMinutes int    `json:"expiry_minutes"`
}

func (SendMagicLinkEmailArgs) Kind() string { return "send_magic_link_email" }

// SendMagicLinkEmailWorker renders the magic-link email and sends it via the
// configured email.Sender.
type SendMagicLinkEmailWorker struct {
	river.WorkerDefaults[SendMagicLinkEmailArgs]
	Sender email.Sender
}

func (w *SendMagicLinkEmailWorker) Work(ctx context.Context, job *river.Job[SendMagicLinkEmailArgs]) error {
	if w.Sender == nil {
		return fmt.Errorf("jobs: SendMagicLinkEmailWorker has nil sender")
	}
	args := job.Args
	expiry := args.ExpiryMinutes
	if expiry < 1 {
		expiry = 1
	}
	textBody, htmlBody := email.MagicLinkBody(args.Link, expiry)
	return w.Sender.Send(ctx, email.Message{
		To:       args.Email,
		Subject:  email.MagicLinkSubject,
		TextBody: textBody,
		HTMLBody: htmlBody,
	})
}
