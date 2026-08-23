package llm

import (
	"fmt"

	"github.com/DowLucas/strong-notes-backend/internal/shorthand"
)

// linePrompt and goalPrompt started as verbatim copies of the plan's Global
// Constraints (docs/superpowers/plans/2026-07-05-strong-notes-go-backend.md)
// and have since evolved (clarifying questions, equipment shorthand) — this
// file is the source of truth. Keep LineGuess in sync with the JSON schema.
func linePrompt(line string, unresolved []string) string {
	return fmt.Sprintf(`You are a gym-log parser. Given this logged line: "%s"
The unrecognized tokens are: %s.
Shorthand convention: a token like "8x3" means 8 reps per set, done for 3 sets - the first number is reps, the second is sets. A bare "x8" means 8 reps.
Superset convention: notes may write supersets as "SS: (A x8 + B x8) x3" or "A 8x3 + B 10x3" - an optional "SS:"/"superset:" prefix, parts joined by "+", optionally wrapped in parentheses, with a trailing "xN" meaning N rounds (sets) of every part. The line you are given may be a single part of such a superset; "SS", "superset" and "+" are never exercise names and must never appear in exerciseName.
Expand any abbreviated or shorthand exercise name into its full common name (e.g. "crabwalk" -> "Crab Walk", "OHP" -> "Overhead Press") rather than echoing the raw token back.
Common exercise shorthand (token=full name): %s. Combine with qualifiers in the line: "romanian dl" -> "Romanian Deadlift", "incline db bp" -> "Incline Dumbbell Bench Press".
Common equipment shorthand: %s. When a token denotes equipment, set "equipment" to its full name, set "equipmentToken" to that exact raw token, and include the equipment in "exerciseName" (e.g. "bb deadlifts" -> "Barbell Deadlift", "db press" -> "Dumbbell Press"). Otherwise set both to null.
Also identify which muscle groups the identified exercise primarily works, using ONLY these exact uppercase values:
["GLUTES","QUADS","HAMSTRINGS","CHEST","BACK","SHOULDERS","ARMS","CORE","CALVES"].
If, after identifying the exercise, one of the unrecognized tokens is a short qualifier/modifier word whose meaning is genuinely ambiguous (e.g. "As" could mean "Assisted", an initialism, or something else) rather than part of the exercise name itself, include a "clarifyingQuestion" object with "kind": "modifier", naming that token, a short question to ask the user, and exactly two distinct, plausible interpretations of it.
If you are NOT confident which exercise is meant (an unfamiliar or ambiguous abbreviation, e.g. "pc" could be Power Clean or Preacher Curl, or a token you cannot map), still fill "exerciseName" with your best guess AND include "clarifyingQuestion" with "kind": "exercise", "token" set to that abbreviation, a question like "Did you mean…?", and exactly two plausible full exercise names as "alternatives" (your best guess first).
Omit "clarifyingQuestion" (null) when you are confident and nothing is ambiguous.
Respond ONLY with JSON: {"exerciseName": string, "equipment": string|null, "equipmentToken": string|null, "weightKg": number|null, "reps": number|null, "sets": number|null, "muscles": string[], "clarifyingQuestion": {"kind": "modifier"|"exercise", "token": string, "question": string, "alternatives": string[]}|null}`, line, joinComma(unresolved), shorthand.ExercisePromptList(), shorthand.PromptList())
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
