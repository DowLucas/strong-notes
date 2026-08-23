// Package shorthand holds the built-in gym shorthand the app understands
// without any per-user dictionary entry. It is the single source of truth
// shared by the LLM prompt/normalizer and the dictionary resolver.
package shorthand

import "strings"

// Equipment maps a shorthand token to its canonical equipment name. Order is
// only used for prompt readability.
var Equipment = []struct{ Token, Name string }{
	{"bb", "Barbell"},
	{"db", "Dumbbell"},
	{"kb", "Kettlebell"},
	{"ez", "EZ Bar"},
	{"bw", "Bodyweight"},
	{"sm", "Smith Machine"},
	{"cbl", "Cable"},
	{"cable", "Cable"},
	{"mc", "Machine"},
	{"machine", "Machine"},
	{"tb", "Trap Bar"},
}

// EquipmentFor returns the canonical name for a known shorthand token
// (case-insensitive), or "" when the token isn't equipment shorthand.
func EquipmentFor(tok string) string {
	lower := strings.ToLower(strings.TrimSpace(tok))
	for _, e := range Equipment {
		if lower == e.Token {
			return e.Name
		}
	}
	return ""
}

// CanonicalEquipmentName returns the canonical name when `s` is either a
// shorthand token or (any-case) a canonical name; otherwise "".
func CanonicalEquipmentName(s string) string {
	lower := strings.ToLower(strings.TrimSpace(s))
	for _, e := range Equipment {
		if lower == e.Token || lower == strings.ToLower(e.Name) {
			return e.Name
		}
	}
	return ""
}

// PromptList renders the table for the LLM prompt: `"bb" = Barbell, ...`.
func PromptList() string {
	parts := make([]string, 0, len(Equipment))
	for _, e := range Equipment {
		parts = append(parts, `"`+e.Token+`" = `+e.Name)
	}
	return strings.Join(parts, ", ")
}
