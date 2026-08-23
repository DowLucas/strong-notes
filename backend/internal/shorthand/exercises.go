package shorthand

import "strings"

// Exercises is the built-in vocabulary of common gym shorthand → full
// exercise name. It is rendered into the LLM prompt so even small models
// expand consistently, and used by the normalizer's fallback when the model
// returns no name. A user's own dictionary entry for a token always wins
// (dictionary resolution happens before the LLM is consulted).
var Exercises = []struct{ Token, Name string }{
	// Lower body
	{"dl", "Deadlift"},
	{"rdl", "Romanian Deadlift"},
	{"sldl", "Stiff-Leg Deadlift"},
	{"sumo", "Sumo Deadlift"},
	{"sq", "Squat"},
	{"bsq", "Back Squat"},
	{"fsq", "Front Squat"},
	{"bss", "Bulgarian Split Squat"},
	{"gm", "Good Morning"},
	{"hip thrust", "Hip Thrust"},
	{"ht", "Hip Thrust"},
	{"lp", "Leg Press"},
	{"le", "Leg Extension"},
	{"lc", "Leg Curl"},
	{"rfess", "Rear-Foot-Elevated Split Squat"},
	{"cr", "Calf Raise"},
	// Push
	{"bp", "Bench Press"},
	{"ibp", "Incline Bench Press"},
	{"dbp", "Dumbbell Bench Press"},
	{"ohp", "Overhead Press"},
	{"ohsp", "Overhead Shoulder Press"},
	{"sp", "Shoulder Press"},
	{"mp", "Military Press"},
	{"cgbp", "Close-Grip Bench Press"},
	{"jm", "JM Press"},
	{"tri", "Triceps Extension"},
	{"skull", "Skull Crusher"},
	{"lr", "Lateral Raise"},
	{"fr", "Front Raise"},
	{"rd", "Rear Delt Fly"},
	{"fly", "Chest Fly"},
	{"dips", "Dips"},
	{"pu", "Push-Up"},
	// Pull
	{"pull up", "Pull-Up"},
	{"pullup", "Pull-Up"},
	{"pullups", "Pull-Up"},
	{"chin", "Chin-Up"},
	{"chins", "Chin-Up"},
	{"row", "Row"},
	{"bor", "Bent-Over Row"},
	{"pendlay", "Pendlay Row"},
	{"lat pd", "Lat Pulldown"},
	{"lpd", "Lat Pulldown"},
	{"pd", "Pulldown"},
	{"fp", "Face Pull"},
	{"shrug", "Shrug"},
	{"bc", "Biceps Curl"},
	{"hc", "Hammer Curl"},
	{"pc", "Preacher Curl"},
	{"cu", "Curl"},
	// Olympic / full body
	{"pc clean", "Power Clean"},
	{"clean", "Clean"},
	{"c&j", "Clean and Jerk"},
	{"snatch", "Snatch"},
	{"kbs", "Kettlebell Swing"},
	{"tgu", "Turkish Get-Up"},
	{"farmer", "Farmer's Carry"},
	// Core / misc
	{"hlr", "Hanging Leg Raise"},
	{"ab wheel", "Ab Wheel Rollout"},
	{"plank", "Plank"},
	{"ghr", "Glute-Ham Raise"},
	{"ghd", "GHD Sit-Up"},
	{"back ext", "Back Extension"},
	{"hyper", "Hyperextension"},
}

var exerciseByToken = func() map[string]string {
	m := make(map[string]string, len(Exercises))
	for _, e := range Exercises {
		m[e.Token] = e.Name
	}
	return m
}()

// ExerciseFor returns the full name for a built-in exercise shorthand token
// (case-insensitive), or "" when unknown.
func ExerciseFor(tok string) string {
	return exerciseByToken[strings.ToLower(strings.TrimSpace(tok))]
}

// ExercisePromptList renders the vocabulary for the LLM prompt:
// `dl=Deadlift, rdl=Romanian Deadlift, …`.
func ExercisePromptList() string {
	parts := make([]string, 0, len(Exercises))
	for _, e := range Exercises {
		parts = append(parts, e.Token+"="+e.Name)
	}
	return strings.Join(parts, ", ")
}
