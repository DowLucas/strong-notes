package science

// MuscleGroups is the fixed 9-value taxonomy shared by exercises' muscle
// maps, goal targets, and the mobile app's heatmap — must match the CHECK
// constraints on the muscle-typed columns in migrations 000010 and 000015.
var MuscleGroups = []string{
	"GLUTES", "QUADS", "HAMSTRINGS", "CHEST", "BACK", "SHOULDERS", "ARMS", "CORE", "CALVES",
}
