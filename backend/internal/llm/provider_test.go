package llm

import (
	"testing"

	"github.com/DowLucas/strong-notes-backend/internal/config"
)

func TestNewProvider_Ollama(t *testing.T) {
	p, err := NewProvider(&config.Config{LLMProvider: "ollama", OllamaURL: "http://localhost:11434", OllamaModel: "gemma2:2b"})
	if err != nil {
		t.Fatalf("NewProvider: %v", err)
	}
	if _, ok := p.(*OllamaProvider); !ok {
		t.Errorf("expected *OllamaProvider, got %T", p)
	}
}

func TestNewProvider_Anthropic(t *testing.T) {
	p, err := NewProvider(&config.Config{LLMProvider: "anthropic", AnthropicAPIKey: "test-key"})
	if err != nil {
		t.Fatalf("NewProvider: %v", err)
	}
	if _, ok := p.(*AnthropicProvider); !ok {
		t.Errorf("expected *AnthropicProvider, got %T", p)
	}
}

// TestNewProvider_AnthropicMissingAPIKey is a regression test proving
// NewProvider fails fast at construction time when LLM_PROVIDER=anthropic
// but ANTHROPIC_API_KEY is empty, instead of booting a doomed client whose
// first real call fails with an opaque error.
func TestNewProvider_AnthropicMissingAPIKey(t *testing.T) {
	_, err := NewProvider(&config.Config{LLMProvider: "anthropic", AnthropicAPIKey: ""})
	if err == nil {
		t.Fatal("expected an error when ANTHROPIC_API_KEY is empty, got nil")
	}
}

func TestNewProvider_Unknown(t *testing.T) {
	_, err := NewProvider(&config.Config{LLMProvider: "bogus"})
	if err == nil {
		t.Fatal("expected an error for unknown LLM_PROVIDER, got nil")
	}
}
