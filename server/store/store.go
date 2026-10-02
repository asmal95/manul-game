// Package store — SQLite-хранилище уровней (и заготовка под рекорды).
// Один файл DATA_DIR/manul.db. Чистый Go (modernc.org/sqlite, без CGO),
// поэтому финальный образ — scratch, как у file-service.
// При пустой базе заливается seed.json — 8 текущих уровней из main.js.
package store

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"unicode"

	"manul-server/validate"

	_ "modernc.org/sqlite"
)

//go:embed seed.json
var seedJSON []byte

// Pit — наследие интервальных пропастей. В хранилище всегда []:
// геометрия нарисована напрямую, на входе API pits запекается в карту.
type Pit [2]int

// Level — уровень в формате API (1-в-1 с объектом LEVELS в main.js + метаданные).
type Level struct {
	ID        int64    `json:"id"`
	Slug      string   `json:"slug"`
	Name      string   `json:"name"`
	Ord       int      `json:"ord"`
	Status    string   `json:"status"`
	Pits      []Pit    `json:"pits"`
	Map       []string `json:"map"`
	CreatedAt string   `json:"created_at"`
	UpdatedAt string   `json:"updated_at"`
}

// seedLevel — запись seed.json (без id и дат).
type seedLevel struct {
	Slug   string   `json:"slug"`
	Name   string   `json:"name"`
	Ord    int      `json:"ord"`
	Status string   `json:"status"`
	Pits   []Pit    `json:"pits"`
	Map    []string `json:"map"`
}

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;`); err != nil {
		db.Close()
		return nil, fmt.Errorf("pragmas: %w", err)
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	if _, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS levels(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  ord INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  pits TEXT NOT NULL DEFAULT '[]',
  map TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_levels_ord ON levels(ord);
CREATE TABLE IF NOT EXISTS scores(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level_id INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  ms INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);`); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM levels`).Scan(&n); err != nil {
		return fmt.Errorf("count: %w", err)
	}
	if n == 0 {
		var seed []seedLevel
		if err := json.Unmarshal(seedJSON, &seed); err != nil {
			return fmt.Errorf("seed decode: %w", err)
		}
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		for _, l := range seed {
			pits, _ := json.Marshal(l.Pits)
			m, _ := json.Marshal(l.Map)
			if _, err := tx.Exec(`INSERT INTO levels(slug,name,ord,status,pits,map) VALUES(?,?,?,?,?,?)`,
				l.Slug, l.Name, l.Ord, l.Status, string(pits), string(m)); err != nil {
				return fmt.Errorf("seed insert %s: %w", l.Slug, err)
			}
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return s.migratePits()
}

// migratePits — разовая миграция с интервальных пропастей на прямую отрисовку:
// запекает pits каждого уровня в карту и чистит поле. Идемпотентна
// (повторный прогон ничего не меняет), версия в таблице meta.
func (s *Store) migratePits() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL)`); err != nil {
		return fmt.Errorf("meta: %w", err)
	}
	var v string
	_ = s.db.QueryRow(`SELECT v FROM meta WHERE k='schema_version'`).Scan(&v)
	if v >= "1" {
		return nil
	}
	rows, err := s.db.Query(`SELECT id, pits, map FROM levels`)
	if err != nil {
		return fmt.Errorf("migration read: %w", err)
	}
	type row struct {
		id   int64
		pits []Pit
		m    []string
	}
	var all []row
	for rows.Next() {
		var r row
		var pits, m string
		if err := rows.Scan(&r.id, &pits, &m); err != nil {
			rows.Close()
			return fmt.Errorf("migration scan: %w", err)
		}
		if err := json.Unmarshal([]byte(pits), &r.pits); err != nil {
			rows.Close()
			return fmt.Errorf("migration pits: %w", err)
		}
		if err := json.Unmarshal([]byte(m), &r.m); err != nil {
			rows.Close()
			return fmt.Errorf("migration map: %w", err)
		}
		all = append(all, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("migration rows: %w", err)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, r := range all {
		pairs := make([][2]int, len(r.pits))
		for i, p := range r.pits {
			pairs[i] = [2]int{p[0], p[1]}
		}
		baked := validate.ApplyPits(r.m, pairs)
		m, _ := json.Marshal(baked)
		if _, err := tx.Exec(`UPDATE levels SET pits='[]', map=?,
		  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, string(m), r.id); err != nil {
			return fmt.Errorf("migration update %d: %w", r.id, err)
		}
	}
	if _, err := tx.Exec(`INSERT INTO meta(k,v) VALUES('schema_version','1')
	  ON CONFLICT(k) DO UPDATE SET v='1'`); err != nil {
		return fmt.Errorf("migration version: %w", err)
	}
	return tx.Commit()
}

// Counts — всего уровней и опубликованных (для лога и /healthz).
func (s *Store) Counts() (total, published int) {
	_ = s.db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(status='published'),0) FROM levels`).Scan(&total, &published)
	return total, published
}

func scanLevel(row interface {
	Scan(dest ...any) error
}) (Level, error) {
	var l Level
	var pits, m string
	err := row.Scan(&l.ID, &l.Slug, &l.Name, &l.Ord, &l.Status, &pits, &m, &l.CreatedAt, &l.UpdatedAt)
	if err != nil {
		return l, err
	}
	if err := json.Unmarshal([]byte(pits), &l.Pits); err != nil {
		return l, fmt.Errorf("pits decode: %w", err)
	}
	if l.Pits == nil {
		l.Pits = []Pit{}
	}
	if err := json.Unmarshal([]byte(m), &l.Map); err != nil {
		return l, fmt.Errorf("map decode: %w", err)
	}
	return l, nil
}

const levelCols = `id,slug,name,ord,status,pits,map,created_at,updated_at`

// ListPublished — уровни для игры (только published, по ord).
func (s *Store) ListPublished() ([]Level, error) {
	rows, err := s.db.Query(`SELECT ` + levelCols + ` FROM levels WHERE status='published' ORDER BY ord,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Level{}
	for rows.Next() {
		l, err := scanLevel(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// ListAll — всё для админки (включая драфты).
func (s *Store) ListAll() ([]Level, error) {
	rows, err := s.db.Query(`SELECT ` + levelCols + ` FROM levels ORDER BY ord,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Level{}
	for rows.Next() {
		l, err := scanLevel(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// GetPublished ищет по id или slug среди опубликованных.
func (s *Store) GetPublished(idOrSlug string) (Level, error) {
	return s.get(idOrSlug, true)
}

// Get ищет по id или slug среди всех (админка, тест-драфт).
func (s *Store) Get(idOrSlug string) (Level, error) {
	return s.get(idOrSlug, false)
}

func (s *Store) get(idOrSlug string, publishedOnly bool) (Level, error) {
	q := `SELECT ` + levelCols + ` FROM levels WHERE `
	var arg any = idOrSlug
	if _, err := fmt.Sscanf(idOrSlug, "%d", new(int)); err == nil {
		q += `id=?`
	} else {
		q += `slug=?`
	}
	if publishedOnly {
		q += ` AND status='published'`
	}
	l, err := scanLevel(s.db.QueryRow(q, arg))
	if err == sql.ErrNoRows {
		return l, ErrNotFound
	}
	return l, err
}

// SlugExists — занятость слага (исключая id при обновлении).
func (s *Store) SlugExists(slug string, exceptID int64) bool {
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM levels WHERE slug=? AND id<>?`, slug, exceptID).Scan(&n)
	return n > 0
}

// Create вставляет уровень, возвращает id.
func (s *Store) Create(l Level) (int64, error) {
	pits, _ := json.Marshal(l.Pits)
	m, _ := json.Marshal(l.Map)
	res, err := s.db.Exec(`INSERT INTO levels(slug,name,ord,status,pits,map) VALUES(?,?,?,?,?,?)`,
		l.Slug, l.Name, l.Ord, l.Status, string(pits), string(m))
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// Update перезаписывает уровень целиком.
func (s *Store) Update(l Level) error {
	pits, _ := json.Marshal(l.Pits)
	m, _ := json.Marshal(l.Map)
	res, err := s.db.Exec(`UPDATE levels SET slug=?,name=?,ord=?,status=?,pits=?,map=?,
	  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
		l.Slug, l.Name, l.Ord, l.Status, string(pits), string(m), l.ID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) Delete(id int64) error {
	res, err := s.db.Exec(`DELETE FROM levels WHERE id=?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// Slugify делает URL-слаг из имени (транслит + дефисы). Пусто не возвращает.
func Slugify(name string) string {
	tr := map[rune]string{
		'а': "a", 'б': "b", 'в': "v", 'г': "g", 'д': "d", 'е': "e", 'ё': "yo",
		'ж': "zh", 'з': "z", 'и': "i", 'й': "y", 'к': "k", 'л': "l", 'м': "m",
		'н': "n", 'о': "o", 'п': "p", 'р': "r", 'с': "s", 'т': "t", 'у': "u",
		'ф': "f", 'х': "h", 'ц': "ts", 'ч': "ch", 'ш': "sh", 'щ': "sch",
		'ъ': "", 'ы': "y", 'ь': "", 'э': "e", 'ю': "yu", 'я': "ya",
	}
	var b strings.Builder
	prevDash := true // ведущие дефисы не нужны
	for _, r := range strings.ToLower(name) {
		var s string
		switch {
		case r >= 'a' && r <= 'z' || r >= '0' && r <= '9':
			s = string(r)
		case unicode.IsSpace(r) || r == '-' || r == '_':
			s = "-"
		default:
			if t, ok := tr[r]; ok {
				s = t
			} else {
				s = "-"
			}
		}
		if s == "-" {
			if !prevDash {
				b.WriteString("-")
				prevDash = true
			}
			continue
		}
		b.WriteString(s)
		prevDash = false
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "level"
	}
	return out
}
