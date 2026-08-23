package jobs

import (
	"context"
	"fmt"
	"net/url"

	"github.com/riverqueue/river"

	"github.com/DowLucas/strong-notes-backend/internal/email"
)

// SendMagicLinkEmailArgs is the payload for one async magic-link email send.
// The auth handler enqueues this when JOBS_ENABLED is set, instead of sending
// the email inline on the request path. This is the worked example of the
// enqueue-from-handler → background-worker pattern.
type SendMagicLinkEmailArgs struct {
	Email string `json:"email"`
	// Code is the raw one-time sign-in code shown in the email.
	Code string `json:"code"`
	// Link is the legacy verify URL (".../api/auth/verify?token=<code>").
	// Jobs enqueued before Code existed carry only this; the worker
	// recovers the code from its token query parameter.
	Link          string `json:"link,omitempty"`
	ExpiryMinutes int    `json:"expiry_minutes"`
}

// code returns the sign-in code, falling back to the token embedded in the
// legacy Link field for jobs that pre-date the Code field.
func (a SendMagicLinkEmailArgs) code() string {
	if a.Code != "" {
		return a.Code
	}
	if u, err := url.Parse(a.Link); err == nil {
		return u.Query().Get("token")
	}
	return ""
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
	textBody, htmlBody := email.MagicLinkBody(args.code(), expiry)
	return w.Sender.Send(ctx, email.Message{
		To:       args.Email,
		Subject:  email.MagicLinkSubject,
		TextBody: textBody,
		HTMLBody: htmlBody,
	})
}
