package jobs

import (
	"context"
	"strings"
	"testing"

	"github.com/riverqueue/river"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/DowLucas/strong-notes-backend/internal/email"
)

func TestSendMagicLinkEmailWorker_SendsToSender(t *testing.T) {
	fake := &email.FakeSender{}
	w := &SendMagicLinkEmailWorker{Sender: fake}

	link := "http://localhost:8080/api/auth/verify?token=abc123"
	err := w.Work(context.Background(), &river.Job[SendMagicLinkEmailArgs]{
		Args: SendMagicLinkEmailArgs{
			Email:         "user@example.com",
			Link:          link,
			ExpiryMinutes: 15,
		},
	})
	require.NoError(t, err)

	require.Len(t, fake.Messages, 1)
	msg := fake.Messages[0]
	assert.Equal(t, "user@example.com", msg.To)
	assert.Equal(t, email.MagicLinkSubject, msg.Subject)
	assert.True(t, strings.Contains(msg.TextBody, link), "text body must contain the verify link")
	assert.True(t, strings.Contains(msg.HTMLBody, link), "html body must contain the verify link")
}

func TestSendMagicLinkEmailWorker_NilSender(t *testing.T) {
	w := &SendMagicLinkEmailWorker{}
	err := w.Work(context.Background(), &river.Job[SendMagicLinkEmailArgs]{
		Args: SendMagicLinkEmailArgs{Email: "user@example.com"},
	})
	require.Error(t, err)
}

func TestRegisterWorkers_BuildsBundle(t *testing.T) {
	workers := RegisterWorkers(&email.FakeSender{})
	require.NotNil(t, workers)
}
