package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// GeminiProvider talks to Google's Generative Language API (Gemini) over its
// REST generateContent endpoint. Like OllamaProvider it depends only on
// net/http + encoding/json — no SDK — to keep the dependency surface minimal.
type GeminiProvider struct {
	APIKey string
	Model  string
}

const geminiBaseURL = "https://generativelanguage.googleapis.com/v1beta"

type geminiPart struct {
	Text string `json:"text"`
}

type geminiContent struct {
	Parts []geminiPart `json:"parts"`
}

type geminiGenerationConfig struct {
	ResponseMIMEType string  `json:"responseMimeType"`
	MaxOutputTokens  int     `json:"maxOutputTokens"`
	Temperature      float64 `json:"temperature"`
}

type geminiGenerateRequest struct {
	Contents         []geminiContent        `json:"contents"`
	GenerationConfig geminiGenerationConfig `json:"generationConfig"`
}

type geminiGenerateResponse struct {
	Candidates []struct {
		Content geminiContent `json:"content"`
	} `json:"candidates"`
}

// generate sends a single prompt and returns the model's raw text response,
// asking Gemini to emit application/json so the guess structs unmarshal
// cleanly — mirroring the Ollama provider's Format:"json".
func (p *GeminiProvider) generate(ctx context.Context, prompt string) (string, error) {
	body, err := json.Marshal(geminiGenerateRequest{
		Contents: []geminiContent{{Parts: []geminiPart{{Text: prompt}}}},
		GenerationConfig: geminiGenerationConfig{
			ResponseMIMEType: "application/json",
			MaxOutputTokens:  512,
			Temperature:      0,
		},
	})
	if err != nil {
		return "", err
	}

	url := fmt.Sprintf("%s/models/%s:generateContent", geminiBaseURL, p.Model)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", p.APIKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("gemini request failed: %d: %s", resp.StatusCode, snippet)
	}

	var out geminiGenerateResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if len(out.Candidates) == 0 || len(out.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("gemini: empty response")
	}
	return out.Candidates[0].Content.Parts[0].Text, nil
}

func (p *GeminiProvider) ResolveLine(ctx context.Context, line string, unresolved []string) (LineGuess, error) {
	raw, err := p.generate(ctx, linePrompt(line, unresolved))
	if err != nil {
		return LineGuess{}, err
	}
	var guess LineGuess
	if err := json.Unmarshal([]byte(raw), &guess); err != nil {
		return LineGuess{}, fmt.Errorf("gemini: parse line guess: %w", err)
	}
	return guess, nil
}

func (p *GeminiProvider) ResolveGoal(ctx context.Context, text string) (GoalGuess, error) {
	raw, err := p.generate(ctx, goalPrompt(text))
	if err != nil {
		return GoalGuess{}, err
	}
	var guess GoalGuess
	if err := json.Unmarshal([]byte(raw), &guess); err != nil {
		return GoalGuess{}, fmt.Errorf("gemini: parse goal guess: %w", err)
	}
	return guess, nil
}
