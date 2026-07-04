package science

import "testing"

func TestVolumeTargets_Hypertrophy(t *testing.T) {
	targets := VolumeTargets("HYPERTROPHY")
	got := targets["GLUTES"]
	want := Range{Min: 12, Max: 20}
	if got != want {
		t.Errorf("HYPERTROPHY GLUTES = %+v, want %+v", got, want)
	}
}

func TestVolumeTargets_StrengthLowerThanHypertrophy(t *testing.T) {
	strength := VolumeTargets("STRENGTH")
	hypertrophy := VolumeTargets("HYPERTROPHY")
	if strength["QUADS"].Max >= hypertrophy["QUADS"].Max {
		t.Errorf("expected STRENGTH QUADS max < HYPERTROPHY QUADS max, got %d >= %d", strength["QUADS"].Max, hypertrophy["QUADS"].Max)
	}
}

func TestVolumeTargets_CoversAllMusclesForAllGoalTypes(t *testing.T) {
	for _, goalType := range []string{"HYPERTROPHY", "STRENGTH", "ENDURANCE", "CUSTOM"} {
		targets := VolumeTargets(goalType)
		for _, muscle := range MuscleGroups {
			if _, ok := targets[muscle]; !ok {
				t.Errorf("%s: missing target for muscle %s", goalType, muscle)
			}
		}
	}
}

// TestVolumeTargets_CustomMutationDoesNotAliasHypertrophy proves that
// VolumeTargets returns an independent copy each call. CUSTOM starts from the
// same underlying values as HYPERTROPHY, so if VolumeTargets ever returned the
// shared package-level map directly, mutating a CUSTOM override would corrupt
// HYPERTROPHY for every other caller (and race concurrent readers).
func TestVolumeTargets_CustomMutationDoesNotAliasHypertrophy(t *testing.T) {
	original := VolumeTargets("HYPERTROPHY")["GLUTES"]

	custom := VolumeTargets("CUSTOM")
	custom["GLUTES"] = Range{Min: 15, Max: 25}

	hypertrophyAfter := VolumeTargets("HYPERTROPHY")
	if hypertrophyAfter["GLUTES"] != original {
		t.Errorf("mutating CUSTOM leaked into HYPERTROPHY: got %+v, want unchanged %+v", hypertrophyAfter["GLUTES"], original)
	}
}

// TestVolumeTargets_UnrecognizedGoalType documents and locks in the behavior
// for an unrecognized goalType: an empty, non-nil map.
func TestVolumeTargets_UnrecognizedGoalType(t *testing.T) {
	targets := VolumeTargets("NOT_A_REAL_GOAL_TYPE")
	if targets == nil {
		t.Fatal("expected non-nil empty map for unrecognized goalType, got nil")
	}
	if len(targets) != 0 {
		t.Errorf("expected empty map for unrecognized goalType, got %+v", targets)
	}
}
