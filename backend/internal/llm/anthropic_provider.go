package llm

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

type AnthropicProvider struct {
	client anthropic.Client
	model  anthropic.Model
}

func NewAnthropicProvider(apiKey string) *AnthropicProvider {
	return &AnthropicProvider{
		client: anthropic.NewClient(option.WithAPIKey(apiKey)),
		model:  anthropic.ModelClaudeHaiku4_5,
	}
}

func (p *AnthropicProvider) ask(ctx context.Context, prompt string) (string, error) {
	msg, err := p.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     p.model,
		MaxTokens: 256,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(prompt)),
		},
	})
	if err != nil {
		return "", err
	}
	if len(msg.Content) == 0 || msg.Content[0].Type != "text" {
		return "", fmt.Errorf("anthropic: unexpected non-text response")
	}
	return msg.Content[0].Text, nil
}

func (p *AnthropicProvider) ResolveLine(ctx context.Context, line string, unresolved []string) (LineGuess, error) {
	raw, err := p.ask(ctx, linePrompt(line, unresolved))
	if err != nil {
		return LineGuess{}, err
	}
	var guess LineGuess
	if err := json.Unmarshal([]byte(raw), &guess); err != nil {
		return LineGuess{}, fmt.Errorf("anthropic: parse line guess: %w", err)
	}
	return guess, nil
}

func (p *AnthropicProvider) ResolveGoal(ctx context.Context, text string) (GoalGuess, error) {
	raw, err := p.ask(ctx, goalPrompt(text))
	if err != nil {
		return GoalGuess{}, err
	}
	var guess GoalGuess
	if err := json.Unmarshal([]byte(raw), &guess); err != nil {
		return GoalGuess{}, fmt.Errorf("anthropic: parse goal guess: %w", err)
	}
	return guess, nil
}
