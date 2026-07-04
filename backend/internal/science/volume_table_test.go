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
