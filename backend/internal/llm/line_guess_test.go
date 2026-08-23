package llm

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestLineGuess_DecodesEquipmentToken(t *testing.T) {
	raw := `{"exerciseName":"Barbell Deadlift","equipment":"Barbell","equipmentToken":"bb","weightKg":30,"reps":8,"sets":3,"muscles":["HAMSTRINGS","GLUTES","BACK"],"clarifyingQuestion":null}`
	var g LineGuess
	if err := json.Unmarshal([]byte(raw), &g); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if g.EquipmentToken == nil || *g.EquipmentToken != "bb" {
		t.Fatalf("EquipmentToken = %v, want bb", g.EquipmentToken)
	}
}

func TestLinePrompt_TeachesEquipmentShorthand(t *testing.T) {
	p := linePrompt("bb deadlifts 30kg 8x3", []string{"bb", "deadlifts"})
	for _, want := range []string{`"bb"`, "Barbell", `"db"`, "Dumbbell", "equipmentToken"} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt missing %q", want)
		}
	}
}
