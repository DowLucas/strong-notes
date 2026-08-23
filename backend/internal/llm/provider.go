package llm

import (
	"context"
	"fmt"

	"github.com/DowLucas/strong-notes-backend/internal/config"
)

type LineGuess struct {
	ExerciseName string  `json:"exerciseName"`
	Equipment    *string `json:"equipment"`
	// EquipmentToken names the raw input token (e.g. "bb") that Equipment was
	// inferred from, so the client can teach the dictionary that shorthand as
	// an equipment modifier rather than binding it to the exercise.
	EquipmentToken     *string             `json:"equipmentToken"`
	WeightKg           *float64            `json:"weightKg"`
	Reps               *int                `json:"reps"`
	Sets               *int                `json:"sets"`
	Muscles            []string            `json:"muscles"`
	ClarifyingQuestion *ClarifyingQuestion `json:"clarifyingQuestion"`
}

// ClarifyingQuestion lets the LLM flag one leftover unresolved token (e.g.
// "As" in "As Dip") as ambiguous rather than silently guessing at it — the
// client can then ask the user to pick one of two suggested meanings or type
// their own, and save the answer to their personal dictionary.
type ClarifyingQuestion struct {
	Token        string   `json:"token"`
	Question     string   `json:"question"`
	Alternatives []string `json:"alternatives"`
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
		if cfg.AnthropicAPIKey == "" {
			return nil, fmt.Errorf("llm: ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic")
		}
		return NewAnthropicProvider(cfg.AnthropicAPIKey), nil
	case "gemini":
		if cfg.GeminiAPIKey == "" {
			return nil, fmt.Errorf("llm: GEMINI_API_KEY is required when LLM_PROVIDER=gemini")
		}
		return &GeminiProvider{APIKey: cfg.GeminiAPIKey, Model: cfg.GeminiModel}, nil
	default:
		return nil, fmt.Errorf("llm: unknown LLM_PROVIDER %q", cfg.LLMProvider)
	}
}
