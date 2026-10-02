// Package validate — структурная проверка карт уровней.
// Порт дизайн-правил из AGENTS.md §6: размеры, алфавит, спавн/выход,
// дыры в земле ≤3 клеток, коробочки расставлены по правилам
// (земля под дропом, свободный верх и низ).
// Геометрия рисуется напрямую; pits на входе — только хелпер импорта
// (проверяется и запекается в карту через ApplyPits, не хранится).
// Проходимость (боты) — отдельный уровень проверки, здесь её нет.
package validate

import (
	"fmt"
	"strings"
)

// Пропасти-хелпер — обычные [2]int [x0,x1].
// Канонический тип для хранения — store.Pit; здесь массивы, чтобы не тащить
// зависимость validate -> store.

// ApplyPits запекает интервальные пропасти в карту: ряды 12+ в колонках
// [x0,x1] становятся пустотой. Зеркало старого applyPits из main.js.
// Возвращает новую карту, вход не трогает.
func ApplyPits(rows []string, pits [][2]int) []string {
	out := make([]string, len(rows))
	copy(out, rows)
	for _, p := range pits {
		for x := p[0]; x <= p[1]; x++ {
			for y := 12; y < len(out); y++ {
				if x < 0 || x >= len(out[y]) {
					continue
				}
				out[y] = out[y][:x] + "." + out[y][x+1:]
			}
		}
	}
	return out
}

// statuses допустимы только эти два.
const (
	StatusDraft     = "draft"
	StatusPublished = "published"
)

var solid = map[byte]bool{'#': true, 'P': true, 'T': true, 'B': true}

var allowed = map[byte]bool{
	'.': true, '#': true, 'P': true, 'A': true, 'M': true,
	'B': true, 'S': true, 'E': true, 'T': true, 'F': true,
}

// Validate возвращает список ошибок. Пустой список = карта валидна.
// Ряды длиной 60 — норма; 61 — наследие 1-го уровня (терпим, не образец).
func Validate(name string, pits [][2]int, rows []string) []string {
	var errs []string
	fail := func(format string, args ...any) {
		errs = append(errs, fmt.Sprintf(format, args...))
	}

	if strings.TrimSpace(name) == "" {
		fail("пустое имя уровня")
	}
	if len([]rune(name)) > 64 {
		fail("имя длиннее 64 символов")
	}
	if len(rows) != 16 {
		fail("рядов должно быть 16, а не %d", len(rows))
		return errs
	}
	widths := map[int]bool{}
	for i, r := range rows {
		if len(r) != 60 && len(r) != 61 {
			fail("ряд %d: длина %d, ждём 60 (61 — только наследие L1)", i, len(r))
		}
		widths[len(r)] = true
		for j := 0; j < len(r); j++ {
			if !allowed[r[j]] {
				fail("ряд %d, колонка %d: недопустимый символ %q", i, j, string(r[j]))
			}
		}
	}

	// спавн и выход
	spawns, exits := 0, 0
	for _, r := range rows {
		spawns += strings.Count(r, "S")
		exits += strings.Count(r, "E")
	}
	if spawns != 1 {
		fail("спавнов S должно быть ровно 1, а не %d", spawns)
	}
	if exits < 1 {
		fail("нет выхода E (нужен хотя бы 1)")
	}

	cols := len(rows[0])
	at := func(x, y int) byte {
		if y < 0 || y >= len(rows) || x < 0 || x >= len(rows[y]) {
			return '.'
		}
		return rows[y][x]
	}

	// пропасти-хелпер: границы и ширина (сами дыры уже запечены в карту,
	// здесь проверяем только осмысленность интервалов)
	for k, p := range pits {
		x0, x1 := p[0], p[1]
		if x0 < 0 || x1 >= cols || x0 > x1 {
			fail("пропасть %d [%d,%d]: вне карты 0..%d", k, x0, x1, cols-1)
			continue
		}
		if x1-x0+1 > 3 {
			fail("пропасть %d [%d,%d]: ширина %d > 3 клеток (прыжок ~90px не долетит)", k, x0, x1, x1-x0+1)
		}
		// Наследие интервальной эпохи: маркер лисы поверх моста выбивал дыру
		// (было на L8). При прямой отрисовке мост виден сразу, но хелпер
		// пусть продолжает ловить этот случай.
		for x := max(0, x0-1); x <= min(cols-1, x1+1); x++ {
			if at(x, 11) == 'F' {
				fail("пропасть %d: лиса F в ряду 11, колонка %d — дыра в мосту над пропастью", k, x)
			}
		}
	}

	// коробочки: под дропом должна быть земля (иначе упадёт в бездну),
	// низ свободен (дроп падает), верх свободен (запрыг)
	for y := 0; y < len(rows); y++ {
		for x := 0; x < len(rows[y]); x++ {
			if rows[y][x] != 'B' {
				continue
			}
			landing := -1
			for yy := y + 1; yy < len(rows); yy++ {
				if solid[at(x, yy)] {
					landing = yy
					break
				}
			}
			if landing < 0 {
				fail("коробочка (%d,%d): под ней нет земли до низа карты — дроп упадёт в бездну", x, y)
			}
			for _, p := range pits {
				if p[0] <= x && x <= p[1] {
					fail("коробочка (%d,%d): стоит над пропастью-хелпером — дроп упадёт в бездну", x, y)
				}
			}
			for _, dy := range []int{1, 2} {
				if c := at(x, y+dy); solid[c] {
					fail("коробочка (%d,%d): под ней %q в ряду %d — путь падения занят", x, y, string(c), y+dy)
				}
			}
			for _, dy := range []int{1, 2} {
				for _, dx := range []int{-1, 0, 1} {
					if c := at(x+dx, y-dy); solid[c] {
						fail("коробочка (%d,%d): над ней %q (%d,%d) — нет простора для запрыга",
							x, y, string(c), x+dx, y-dy)
					}
				}
			}
		}
	}
	return errs
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
