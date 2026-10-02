package validate

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// Seed обязан проходить собственную валидацию — иначе сломаем игру
// расхождением «сервер говорит ок, а сид невалиден».
func TestSeedValid(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "store", "seed.json"))
	if err != nil {
		t.Skip("no seed.json yet")
	}
	var seed []struct {
		Name string   `json:"name"`
		Pits [][2]int `json:"pits"`
		Map  []string `json:"map"`
	}
	if err := json.Unmarshal(raw, &seed); err != nil {
		t.Fatal(err)
	}
	if len(seed) == 0 {
		t.Fatal("empty seed")
	}
	for i, l := range seed {
		if errs := Validate(l.Name, l.Pits, l.Map); len(errs) > 0 {
			t.Errorf("seed %d (%s): %v", i, l.Name, errs)
		}
	}
}

func TestRejectsGarbage(t *testing.T) {
	rows := make([]string, 16)
	for i := range rows {
		rows[i] = "............................................................"
	}
	if errs := Validate("", nil, rows); len(errs) == 0 {
		t.Error("empty name + no spawn/exit must fail")
	}
	bad := append([]string{}, rows...)
	bad[11] = "S.....######PPPPF.............................................E."
	if errs := Validate("trap", [][2]int{{30, 32}}, bad); len(errs) == 0 {
		t.Error("fox on bridge band must fail")
	}
}

func TestApplyPits(t *testing.T) {
	rows := make([]string, 16)
	for i := range rows {
		rows[i] = "############################################################"
	}
	rows[11] = "S..........................PPPPP.............................E."
	got := ApplyPits(rows, [][2]int{{27, 29}})
	if got[11] != rows[11] {
		t.Error("row 11 must survive the cut")
	}
	for _, y := range []int{12, 13, 14, 15} {
		if got[y][27:30] != "..." || got[y][26] != '#' || got[y][30] != '#' {
			t.Errorf("row %d not cut as expected: %q", y, got[y][24:33])
		}
	}
	if rows[12][27:30] != "###" {
		t.Error("ApplyPits must not touch the input")
	}
}

func TestBoxNeedsLanding(t *testing.T) {
	rows := make([]string, 16)
	for i := range rows {
		rows[i] = "............................................................"
	}
	put := func(y, x int, c byte) {
		rows[y] = rows[y][:x] + string(c) + rows[y][x+1:]
	}
	put(11, 0, 'S')
	put(11, 59, 'E')
	put(9, 25, 'B')
	// под коробочкой только бездна — обязана зафейлиться
	if errs := Validate("boxy", nil, rows); len(errs) == 0 {
		t.Error("box over the void must fail")
	}
	for x := 0; x < 60; x++ {
		put(12, x, '#')
	}
	if errs := Validate("boxy", nil, rows); len(errs) > 0 {
		t.Errorf("box with landing must pass: %v", errs)
	}
}
