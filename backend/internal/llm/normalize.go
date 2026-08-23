package llm

import (
	"strings"

	"github.com/DowLucas/strong-notes-backend/internal/shorthand"
	"unicode"
	"unicode/utf8"

	"github.com/DowLucas/strong-notes-backend/internal/science"
)

// muscleSynonyms maps common model outputs onto the fixed MuscleGroups
// taxonomy. Keys are upper-cased, trimmed.
var muscleSynonyms = map[string]string{
	"LOWER BACK": "BACK", "UPPER BACK": "BACK", "LATS": "BACK", "TRAPS": "BACK", "ERECTORS": "BACK",
	"PECS": "CHEST", "PECTORALS": "CHEST",
	"DELTS": "SHOULDERS", "DELTOIDS": "SHOULDERS", "REAR DELTS": "SHOULDERS",
	"BICEPS": "ARMS", "TRICEPS": "ARMS", "FOREARMS": "ARMS",
	"ABS": "CORE", "OBLIQUES": "CORE", "ABDOMINALS": "CORE",
	"LEGS": "QUADS", "QUADRICEPS": "QUADS",
	"HAMS": "HAMSTRINGS",
	"HIPS": "GLUTES", "HIP": "GLUTES", "GLUTE": "GLUTES",
	"CALF": "CALVES",
}

var validMuscle = func() map[string]bool {
	m := make(map[string]bool, len(science.MuscleGroups))
	for _, g := range science.MuscleGroups {
		m[g] = true
	}
	return m
}()

// canonicalEquipment expands shorthand ("db" → "Dumbbell") and otherwise
// title-cases a free-text equipment name. Blank → nil.
func canonicalEquipment(raw *string) *string {
	if raw == nil {
		return nil
	}
	s := strings.TrimSpace(*raw)
	if s == "" {
		return nil
	}
	if name := shorthand.CanonicalEquipmentName(s); name != "" {
		return &name
	}
	words := strings.Fields(strings.ToLower(s))
	for i, w := range words {
		words[i] = capitalize(w)
	}
	out := strings.Join(words, " ")
	return &out
}

// canonicalMuscles upper-cases, maps synonyms, drops unknowns and dedupes,
// preserving first-seen order. Never returns nil so JSON shows [] not null.
func canonicalMuscles(raw []string) []string {
	out := make([]string, 0, len(raw))
	seen := map[string]bool{}
	for _, m := range raw {
		k := strings.ToUpper(strings.TrimSpace(m))
		if syn, ok := muscleSynonyms[k]; ok {
			k = syn
		}
		if !validMuscle[k] || seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, k)
	}
	return out
}

// NormalizeLineGuess coerces a model's free-form answer into the shapes the
// rest of the system validates against (muscle enum, canonical equipment
// names), so a sloppy-but-correct guess never fails at confirm time. When
// the model returns no exercise name at all, a deterministic fallback is
// built from the unresolved tokens (`bb rows` → "Barbell Rows") so the
// client never shows a blank title.
func NormalizeLineGuess(unresolved []string, g LineGuess) LineGuess {
	g.ExerciseName = strings.TrimSpace(g.ExerciseName)
	g.Muscles = canonicalMuscles(g.Muscles)
	g.Equipment = canonicalEquipment(g.Equipment)
	if g.Equipment == nil {
		g.EquipmentToken = nil
	} else if g.EquipmentToken != nil {
		tok := strings.TrimSpace(*g.EquipmentToken)
		if tok == "" {
			g.EquipmentToken = nil
		} else {
			g.EquipmentToken = &tok
		}
	}
	if isPlaceholderName(g.ExerciseName) {
		g.ExerciseName = ""
	}
	if g.Equipment == nil {
		g = equipmentFromTokens(unresolved, g)
	}
	if g.ExerciseName == "" {
		g = fallbackFromTokens(unresolved, g)
	} else if g.Equipment != nil {
		g.ExerciseName = nameWithEquipment(g.ExerciseName, *g.Equipment, g.EquipmentToken)
	}
	return g
}

// equipmentFromTokens sets Equipment/EquipmentToken from the first unresolved
// token that is known equipment shorthand — the model may simply have
// dropped it.
func equipmentFromTokens(unresolved []string, g LineGuess) LineGuess {
	for _, tok := range unresolved {
		tok = strings.TrimSpace(tok)
		if name := shorthand.EquipmentFor(tok); name != "" {
			g.Equipment = &name
			g.EquipmentToken = &tok
			return g
		}
	}
	return g
}

// nameWithEquipment makes sure the equipment is part of the exercise name
// exactly once: a leading raw token ("db Overhead Press") is replaced by the
// canonical name, a name that already mentions the equipment is left alone,
// and anything else gets the equipment prefixed.
func nameWithEquipment(name, equipment string, token *string) string {
	if strings.Contains(strings.ToLower(name), strings.ToLower(equipment)) {
		return name
	}
	if token != nil {
		words := strings.Fields(name)
		if len(words) > 1 && strings.EqualFold(words[0], *token) {
			return equipment + " " + strings.Join(words[1:], " ")
		}
	}
	return equipment + " " + name
}

var placeholderNames = map[string]bool{"null": true, "none": true, "unknown": true, "n/a": true, "na": true, "undefined": true}

func isPlaceholderName(name string) bool {
	return placeholderNames[strings.ToLower(strings.TrimSpace(name))]
}

// fallbackFromTokens builds a name from the unresolved tokens when the model
// gave none: known equipment shorthand is expanded (and recorded as the
// guess's equipment if the model didn't set one), the remaining tokens are
// kept as written apart from a capital first letter (they may be the user's
// own abbreviation, e.g. "OHSP"), and
// the canonical equipment name goes first.
func fallbackFromTokens(unresolved []string, g LineGuess) LineGuess {
	var rest []string
	for _, tok := range unresolved {
		tok = strings.TrimSpace(tok)
		if tok == "" {
			continue
		}
		if g.EquipmentToken != nil && strings.EqualFold(tok, *g.EquipmentToken) {
			continue
		}
		rest = append(rest, capitalize(tok))
	}
	words := rest
	if g.Equipment != nil {
		words = append([]string{*g.Equipment}, rest...)
	}
	g.ExerciseName = strings.Join(words, " ")
	return g
}

// capitalize upper-cases the first letter only, leaving the rest as written
// ("rows" → "Rows", "OHSP" stays "OHSP"). Rune-aware so multi-byte first
// letters ("övre" → "Övre") are not split mid-character.
func capitalize(tok string) string {
	if tok == "" {
		return ""
	}
	r, size := utf8.DecodeRuneInString(tok)
	return string(unicode.ToUpper(r)) + tok[size:]
}
