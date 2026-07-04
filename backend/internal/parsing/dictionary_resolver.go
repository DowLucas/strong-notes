package parsing

import (
	"context"
	"regexp"
	"strings"

	"github.com/DowLucas/strong-notes-backend/internal/db"
)

// numericToken matches weight (e.g. "40kg", "30", "40.5lb") and reps×sets
// (e.g. "8x3") tokens, which are never looked up against the abbreviation
// dictionary — only word tokens (exercise/equipment shorthand) are.
var numericToken = regexp.MustCompile(`(?i)^\d+(\.\d+)?(kg|lb)?$|^\d+x\d+$`)

type ResolvedToken struct {
	Token         string  `json:"token"`
	Type          string  `json:"type"` // "exercise" | "modifier"
	ExerciseID    *string `json:"exerciseId,omitempty"`
	ModifierType  *string `json:"modifierType,omitempty"`
	ModifierValue *string `json:"modifierValue,omitempty"`
}

type DictionaryResolution struct {
	ResolvedTokens   []ResolvedToken
	UnresolvedTokens []string
}

// ResolveLineWithDictionary tokenizes line, excludes numeric tokens, and
// looks up each remaining word token against userID's Abbreviation table.
func ResolveLineWithDictionary(ctx context.Context, q *db.Queries, userID, line string) (DictionaryResolution, error) {
	rawTokens := strings.Fields(line)
	var wordTokens []string
	for _, t := range rawTokens {
		if !numericToken.MatchString(t) {
			wordTokens = append(wordTokens, strings.ToUpper(t))
		}
	}

	abbreviations, err := q.FindAbbreviationsForTokens(ctx, db.FindAbbreviationsForTokensParams{UserID: userID, Tokens: wordTokens})
	if err != nil {
		return DictionaryResolution{}, err
	}

	byToken := make(map[string]db.Abbreviation, len(abbreviations))
	for _, a := range abbreviations {
		byToken[strings.ToUpper(a.Token)] = a
	}

	var resolved []ResolvedToken
	var unresolved []string
	for _, original := range rawTokens {
		if numericToken.MatchString(original) {
			continue
		}
		match, ok := byToken[strings.ToUpper(original)]
		if !ok {
			unresolved = append(unresolved, original)
			continue
		}
		if match.ExerciseID != nil {
			resolved = append(resolved, ResolvedToken{Token: original, Type: "exercise", ExerciseID: match.ExerciseID})
		} else {
			resolved = append(resolved, ResolvedToken{Token: original, Type: "modifier", ModifierType: match.ModifierType, ModifierValue: match.ModifierValue})
		}
	}

	return DictionaryResolution{ResolvedTokens: resolved, UnresolvedTokens: unresolved}, nil
}
