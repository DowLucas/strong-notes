package llm

import (
	"context"
	"fmt"

	"github.com/DowLucas/strong-notes-backend/internal/config"
)

type LineGuess struct {
	ExerciseName string   `json:"exerciseName"`
	Equipment    *string  `json:"equipment"`
	WeightKg     *float64 `json:"weightKg"`
	Reps         *int     `json:"reps"`
	Sets         *int     `json:"sets"`
	Muscles      []string `json:"muscles"`
}

type GoalGuess struct {
	Type    string   `json:"type"`
	Muscles []string `json:"muscles"`
}

type Provider interface {
	ResolveLine(ctx context.Context, line string, unresolved []string) (LineGuess, error)
	ResolveGoal(ctx context.Context, text string) (GoalGuess, error)
}

// NewProvider selects the LLM provider based on cfg.LLMProvider. Construction
// never touches the network — the returned Provider's methods do.
func NewProvider(cfg *config.Config) (Provider, error) {
	switch cfg.LLMProvider {
	case "ollama":
		return &OllamaProvider{BaseURL: cfg.OllamaURL, Model: cfg.OllamaModel}, nil
	case "anthropic":
		return NewAnthropicProvider(cfg.AnthropicAPIKey), nil
	default:
		return nil, fmt.Errorf("llm: unknown LLM_PROVIDER %q", cfg.LLMProvider)
	}
}
