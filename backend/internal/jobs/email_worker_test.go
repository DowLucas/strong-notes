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

	err := w.Work(context.Background(), &river.Job[SendMagicLinkEmailArgs]{
		Args: SendMagicLinkEmailArgs{
			Email:         "user@example.com",
			Code:          "abc123",
			ExpiryMinutes: 15,
		},
	})
	require.NoError(t, err)

	require.Len(t, fake.Messages, 1)
	msg := fake.Messages[0]
	assert.Equal(t, "user@example.com", msg.To)
	assert.Equal(t, email.MagicLinkSubject, msg.Subject)
	assert.True(t, strings.Contains(msg.TextBody, "abc123"), "text body must contain the sign-in code")
	assert.True(t, strings.Contains(msg.HTMLBody, "abc123"), "html body must contain the sign-in code")
}

// Jobs enqueued by an older server carry only the verify link; the code is
// recovered from its token parameter.
func TestSendMagicLinkEmailWorker_LegacyLinkOnlyArgs(t *testing.T) {
	fake := &email.FakeSender{}
	w := &SendMagicLinkEmailWorker{Sender: fake}

	err := w.Work(context.Background(), &river.Job[SendMagicLinkEmailArgs]{
		Args: SendMagicLinkEmailArgs{
			Email:         "user@example.com",
			Link:          "http://localhost:8080/api/auth/verify?token=legacy123",
			ExpiryMinutes: 15,
		},
	})
	require.NoError(t, err)
	require.Len(t, fake.Messages, 1)
	assert.True(t, strings.Contains(fake.Messages[0].TextBody, "legacy123"), "code must be recovered from the legacy link")
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
