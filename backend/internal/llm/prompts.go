package llm

import "fmt"

// LinePrompt and GoalPrompt are copied verbatim from the plan's Global
// Constraints — do not edit the wording without updating both there and here.
func linePrompt(line string, unresolved []string) string {
	return fmt.Sprintf(`You are a gym-log parser. Given this logged line: "%s"
The unrecognized tokens are: %s.
Shorthand convention: a token like "8x3" means 8 reps per set, done for 3 sets - the first number is reps, the second is sets.
Expand any abbreviated or shorthand exercise name into its full common name (e.g. "crabwalk" -> "Crab Walk", "OHP" -> "Overhead Press") rather than echoing the raw token back.
Also identify which muscle groups the identified exercise primarily works, from
["GLUTES","QUADS","HAMSTRINGS","CHEST","BACK","SHOULDERS","ARMS","CORE","CALVES"].
If, after identifying the exercise, one of the unrecognized tokens is a short qualifier/modifier word whose meaning is genuinely ambiguous (e.g. "As" could mean "Assisted", an initialism, or something else) rather than part of the exercise name itself, include a "clarifyingQuestion" object naming that token, a short question to ask the user, and exactly two distinct, plausible interpretations of it. Omit "clarifyingQuestion" (null) when nothing is ambiguous.
Respond ONLY with JSON: {"exerciseName": string, "equipment": string|null, "weightKg": number|null, "reps": number|null, "sets": number|null, "muscles": string[], "clarifyingQuestion": {"token": string, "question": string, "alternatives": string[]}|null}`, line, joinComma(unresolved))
}

func goalPrompt(text string) string {
	return fmt.Sprintf(`You are a fitness goal classifier. Given this goal description: "%s"
Respond ONLY with JSON: {"type": "HYPERTROPHY"|"STRENGTH"|"ENDURANCE"|"CUSTOM", "muscles": string[]} where muscles are from
["GLUTES","QUADS","HAMSTRINGS","CHEST","BACK","SHOULDERS","ARMS","CORE","CALVES"].`, text)
}

func joinComma(items []string) string {
	out := ""
	for i, item := range items {
		if i > 0 {
			out += ", "
		}
		out += item
	}
	return out
}
