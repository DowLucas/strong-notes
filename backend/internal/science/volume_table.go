package science

// Range is an inclusive weekly set-count target for one muscle group.
type Range struct {
	Min int
	Max int
}

var hypertrophy = map[string]Range{
	"GLUTES": {12, 20}, "QUADS": {10, 18}, "HAMSTRINGS": {8, 16},
	"CHEST": {10, 18}, "BACK": {10, 16}, "SHOULDERS": {8, 16},
	"ARMS": {6, 14}, "CORE": {6, 12}, "CALVES": {8, 16},
}

var strength = map[string]Range{
	"GLUTES": {4, 8}, "QUADS": {4, 8}, "HAMSTRINGS": {3, 6},
	"CHEST": {3, 6}, "BACK": {4, 8}, "SHOULDERS": {3, 6},
	"ARMS": {2, 5}, "CORE": {3, 6}, "CALVES": {3, 6},
}

var endurance = map[string]Range{
	"GLUTES": {8, 14}, "QUADS": {8, 14}, "HAMSTRINGS": {6, 12},
	"CHEST": {6, 12}, "BACK": {6, 12}, "SHOULDERS": {6, 12},
	"ARMS": {5, 10}, "CORE": {8, 14}, "CALVES": {8, 14},
}

var table = map[string]map[string]Range{
	"HYPERTROPHY": hypertrophy,
	"STRENGTH":    strength,
	"ENDURANCE":   endurance,
	"CUSTOM":      hypertrophy, // CUSTOM starts from hypertrophy defaults; callers override per-muscle
}

// VolumeTargets returns a fresh copy of the weekly set-count range per muscle
// group for the given goal type. Callers are free to mutate the returned map
// (e.g. to apply per-muscle overrides for CUSTOM) without affecting the
// shared package-level tables or other callers. Returns an empty, non-nil map
// for an unrecognized goalType.
func VolumeTargets(goalType string) map[string]Range {
	src := table[goalType]
	targets := make(map[string]Range, len(src))
	for muscle, r := range src {
		targets[muscle] = r
	}
	return targets
}
