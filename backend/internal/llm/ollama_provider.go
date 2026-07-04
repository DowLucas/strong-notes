package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

type OllamaProvider struct {
	BaseURL string
	Model   string
}

type ollamaGenerateRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
	Stream bool   `json:"stream"`
	Format string `json:"format"`
}

type ollamaGenerateResponse struct {
	Response string `json:"response"`
}

func (p *OllamaProvider) generate(ctx context.Context, prompt string) (string, error) {
	body, err := json.Marshal(ollamaGenerateRequest{Model: p.Model, Prompt: prompt, Stream: false, Format: "json"})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.BaseURL+"/api/generate", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("ollama request failed: %d", resp.StatusCode)
	}

	var out ollamaGenerateResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	return out.Response, nil
}

func (p *OllamaProvider) ResolveLine(ctx context.Context, line string, unresolved []string) (LineGuess, error) {
	raw, err := p.generate(ctx, linePrompt(line, unresolved))
	if err != nil {
		return LineGuess{}, err
	}
	var guess LineGuess
	if err := json.Unmarshal([]byte(raw), &guess); err != nil {
		return LineGuess{}, fmt.Errorf("ollama: parse line guess: %w", err)
	}
	return guess, nil
}

func (p *OllamaProvider) ResolveGoal(ctx context.Context, text string) (GoalGuess, error) {
	raw, err := p.generate(ctx, goalPrompt(text))
	if err != nil {
		return GoalGuess{}, err
	}
	var guess GoalGuess
	if err := json.Unmarshal([]byte(raw), &guess); err != nil {
		return GoalGuess{}, fmt.Errorf("ollama: parse goal guess: %w", err)
	}
	return guess, nil
}
