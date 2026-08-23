package parsing

import (
	"context"
	"regexp"
	"strings"

	"github.com/DowLucas/strong-notes-backend/internal/db"
	"github.com/DowLucas/strong-notes-backend/internal/shorthand"
)

// numericToken matches weight (e.g. "40kg", "30", "40.5lb") and reps×sets
// (e.g. "8x3") tokens, which are never looked up against the abbreviation
// dictionary — only word tokens (exercise/equipment shorthand) are.
var numericToken = regexp.MustCompile(`(?i)^\d+(\.\d+)?(kg|lb)?$|^\d+x\d+$`)

type ResolvedToken struct {
	Token         string  `json:"token"`
	Type          string  `json:"type"` // "exercise" | "modifier"
	ExerciseID    *string `json:"exerciseId,omitempty"`
	ExerciseName  *string `json:"exerciseName,omitempty"`
	ModifierType  *string `json:"modifierType,omitempty"`
	ModifierValue *string `json:"modifierValue,omitempty"`
}

type DictionaryResolution struct {
	ResolvedTokens   []ResolvedToken
	UnresolvedTokens []string
}

// CanonicalToken is the dictionary's key form for a token: trimmed and
// upper-cased. New abbreviations are stored in this form; lookups compare in
// it too, so rows created before canonicalisation still match.
func CanonicalToken(t string) string {
	return strings.ToUpper(strings.TrimSpace(t))
}

// ResolveLineWithDictionary tokenizes line, excludes numeric tokens, and
// looks up each remaining word token against userID's Abbreviation table.
func ResolveLineWithDictionary(ctx context.Context, q *db.Queries, userID, line string) (DictionaryResolution, error) {
	rawTokens := strings.Fields(line)
	var wordTokens []string
	for _, t := range rawTokens {
		if !numericToken.MatchString(t) {
			wordTokens = append(wordTokens, CanonicalToken(t))
		}
	}

	abbreviations, err := q.FindAbbreviationsForTokens(ctx, db.FindAbbreviationsForTokensParams{UserID: userID, Tokens: wordTokens})
	if err != nil {
		return DictionaryResolution{}, err
	}

	byToken := make(map[string]db.Abbreviation, len(abbreviations))
	var exerciseIDs []string
	for _, a := range abbreviations {
		byToken[CanonicalToken(a.Token)] = a
		if a.ExerciseID != nil {
			exerciseIDs = append(exerciseIDs, *a.ExerciseID)
		}
	}
	names, err := ExerciseNamesByID(ctx, q, exerciseIDs)
	if err != nil {
		return DictionaryResolution{}, err
	}

	// Non-nil so the JSON is [] rather than null when nothing matched.
	resolved := []ResolvedToken{}
	unresolved := []string{}
	for _, original := range rawTokens {
		if numericToken.MatchString(original) {
			continue
		}
		match, ok := byToken[CanonicalToken(original)]
		if !ok {
			// Built-in equipment shorthand ("bb", "db", …) resolves without a
			// per-user entry; a user's own entry for the token (above) wins.
			if name := shorthand.EquipmentFor(original); name != "" {
				equipment := "equipment"
				resolved = append(resolved, ResolvedToken{Token: original, Type: "modifier", ModifierType: &equipment, ModifierValue: &name})
				continue
			}
			unresolved = append(unresolved, original)
			continue
		}
		if match.ExerciseID != nil {
			token := ResolvedToken{Token: original, Type: "exercise", ExerciseID: match.ExerciseID}
			if name, ok := names[*match.ExerciseID]; ok {
				token.ExerciseName = &name
			}
			resolved = append(resolved, token)
		} else {
			resolved = append(resolved, ResolvedToken{Token: original, Type: "modifier", ModifierType: match.ModifierType, ModifierValue: match.ModifierValue})
		}
	}

	return DictionaryResolution{ResolvedTokens: resolved, UnresolvedTokens: unresolved}, nil
}
