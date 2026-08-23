package llm

import (
	"reflect"
	"testing"
)

func strp(s string) *string { return &s }

func TestNormalizeLineGuess_Muscles(t *testing.T) {
	g := NormalizeLineGuess(nil, LineGuess{
		ExerciseName: "Dumbbell Press",
		Muscles:      []string{"Chest", " shoulders ", "Triceps", "Lower back", "Legs", "Nonsense", "CHEST"},
	})
	want := []string{"CHEST", "SHOULDERS", "ARMS", "BACK", "QUADS"}
	if !reflect.DeepEqual(g.Muscles, want) {
		t.Fatalf("Muscles = %v, want %v", g.Muscles, want)
	}
}

func TestNormalizeLineGuess_EmptyMusclesStaysEmptyNotNil(t *testing.T) {
	g := NormalizeLineGuess(nil, LineGuess{ExerciseName: "X", Muscles: []string{"???"}})
	if g.Muscles == nil || len(g.Muscles) != 0 {
		t.Fatalf("Muscles = %#v, want empty non-nil slice", g.Muscles)
	}
}

func TestNormalizeLineGuess_EquipmentShorthandExpanded(t *testing.T) {
	cases := map[string]string{"db": "Dumbbell", "BB": "Barbell", "kb": "Kettlebell", "Dumbbell": "Dumbbell", "cable": "Cable", "smith machine": "Smith Machine"}
	for in, want := range cases {
		g := NormalizeLineGuess(nil, LineGuess{ExerciseName: "X", Equipment: strp(in)})
		if g.Equipment == nil || *g.Equipment != want {
			t.Errorf("Equipment %q -> %v, want %q", in, g.Equipment, want)
		}
	}
}

func TestNormalizeLineGuess_EquipmentBlankBecomesNil(t *testing.T) {
	g := NormalizeLineGuess(nil, LineGuess{ExerciseName: "X", Equipment: strp("  "), EquipmentToken: strp("bb")})
	if g.Equipment != nil || g.EquipmentToken != nil {
		t.Fatalf("expected nil equipment and token, got %v %v", g.Equipment, g.EquipmentToken)
	}
}

func TestNormalizeLineGuess_TrimsName(t *testing.T) {
	g := NormalizeLineGuess(nil, LineGuess{ExerciseName: "  Barbell Deadlift "})
	if g.ExerciseName != "Barbell Deadlift" {
		t.Fatalf("ExerciseName = %q", g.ExerciseName)
	}
}

func TestLinePrompt_UsesSharedEquipmentTable(t *testing.T) {
	p := linePrompt("x", nil)
	for _, want := range []string{`"bb" = Barbell`, `"db" = Dumbbell`, `"kb" = Kettlebell`} {
		if !contains(p, want) {
			t.Errorf("prompt missing %q", want)
		}
	}
}

func contains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && indexOf(s, sub) >= 0)
}
func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func TestNormalizeLineGuess_EmptyNameFallsBackToTokens(t *testing.T) {
	g := NormalizeLineGuess([]string{"bb", "rows"}, LineGuess{ExerciseName: "  ", Equipment: strp("bb"), EquipmentToken: strp("bb")})
	if g.ExerciseName != "Barbell Rows" {
		t.Fatalf("ExerciseName = %q, want Barbell Rows", g.ExerciseName)
	}
	g = NormalizeLineGuess([]string{"crabwalk"}, LineGuess{ExerciseName: ""})
	if g.ExerciseName != "Crabwalk" {
		t.Fatalf("ExerciseName = %q, want Crabwalk", g.ExerciseName)
	}
	// Nothing to fall back on: stays empty rather than inventing a name.
	g = NormalizeLineGuess(nil, LineGuess{ExerciseName: ""})
	if g.ExerciseName != "" {
		t.Fatalf("ExerciseName = %q, want empty", g.ExerciseName)
	}
}

func TestLinePrompt_TeachesSupersetConvention(t *testing.T) {
	p := linePrompt("db OHSP", []string{"db", "OHSP"})
	for _, want := range []string{"Superset convention", `"SS:"`, `"+"`, "rounds (sets)", `bare "x8"`} {
		if !contains(p, want) {
			t.Errorf("prompt missing %q", want)
		}
	}
}

func TestNormalizeLineGuess_EquipmentFoldedIntoName(t *testing.T) {
	cases := map[string]string{
		"db Overhead Press":       "Dumbbell Overhead Press",
		"Overhead Press":          "Dumbbell Overhead Press",
		"Dumbbell Overhead Press": "Dumbbell Overhead Press",
		"dumbbell overhead press": "dumbbell overhead press", // already mentions it (any case) — left alone
	}
	for in, want := range cases {
		g := NormalizeLineGuess([]string{"db", "OHSP"}, LineGuess{ExerciseName: in, Equipment: strp("db"), EquipmentToken: strp("db")})
		if g.ExerciseName != want {
			t.Errorf("%q -> %q, want %q", in, g.ExerciseName, want)
		}
	}
}

func TestNormalizeLineGuess_PlaceholderNamesTreatedAsEmpty(t *testing.T) {
	for _, junk := range []string{"null", "NULL", "none", "unknown", "n/a"} {
		g := NormalizeLineGuess([]string{"db", "OHSP"}, LineGuess{ExerciseName: junk})
		if g.ExerciseName != "Dumbbell OHSP" {
			t.Errorf("%q -> %q, want Dumbbell OHSP", junk, g.ExerciseName)
		}
	}
}

func TestNormalizeLineGuess_FallbackExpandsShorthandAndSetsEquipment(t *testing.T) {
	g := NormalizeLineGuess([]string{"db", "OHSP"}, LineGuess{ExerciseName: ""})
	if g.ExerciseName != "Dumbbell OHSP" {
		t.Fatalf("ExerciseName = %q", g.ExerciseName)
	}
	if g.Equipment == nil || *g.Equipment != "Dumbbell" || g.EquipmentToken == nil || *g.EquipmentToken != "db" {
		t.Fatalf("equipment = %v / token = %v, want Dumbbell / db", g.Equipment, g.EquipmentToken)
	}
}

func TestNormalizeLineGuess_ShorthandAppliedEvenWhenModelDropsEquipment(t *testing.T) {
	g := NormalizeLineGuess([]string{"bb", "rows"}, LineGuess{ExerciseName: "Rows", Muscles: []string{"BACK"}})
	if g.ExerciseName != "Barbell Rows" {
		t.Fatalf("ExerciseName = %q", g.ExerciseName)
	}
	if g.Equipment == nil || *g.Equipment != "Barbell" || g.EquipmentToken == nil || *g.EquipmentToken != "bb" {
		t.Fatalf("equipment = %v / token = %v", g.Equipment, g.EquipmentToken)
	}
}

func TestCapitalize_RuneAware(t *testing.T) {
	cases := map[string]string{
		"övre": "Övre",
		"rows": "Rows",
		"OHSP": "OHSP",
		"":     "",
	}
	for in, want := range cases {
		if got := capitalize(in); got != want {
			t.Errorf("capitalize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNormalizeLineGuess_FallbackNameIsRuneAware(t *testing.T) {
	g := NormalizeLineGuess([]string{"övre", "rygg"}, LineGuess{ExerciseName: ""})
	if g.ExerciseName != "Övre Rygg" {
		t.Fatalf("ExerciseName = %q, want Övre Rygg", g.ExerciseName)
	}
}

func TestNormalizeLineGuess_EquipmentTitleCaseIsRuneAware(t *testing.T) {
	g := NormalizeLineGuess(nil, LineGuess{ExerciseName: "X", Equipment: strp("östlig maskin")})
	if g.Equipment == nil || *g.Equipment != "Östlig Maskin" {
		t.Fatalf("Equipment = %v, want Östlig Maskin", g.Equipment)
	}
}
