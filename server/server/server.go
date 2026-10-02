// Package server — HTTP-слой: публичное API уровней, админка с сессией,
// раздача статики игры. Паттерны — как у file-service-go: ServeMux,
// JSON-ошибки {"error":"..."}, лимиты тела через MaxBytesReader.
package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"manul-server/auth"
	"manul-server/store"
	"manul-server/validate"
)

const (
	maxLevelBody = 64 << 10 // уровень ~6KB JSON, с запасом
	maxLoginBody = 4 << 10
)

// Config — настройки сервера. SessionSecret обязателен; если пуст,
// генерируется эфемерный (сессии умрут при рестарте — в лог предупреждение).
type Config struct {
	WebRoot       string
	AdminLogin    string
	AdminPassHash string
	SessionSecret string
}

type Server struct {
	store  *store.Store
	web    string
	login  string
	phash  []byte
	secret []byte
}

func New(st *store.Store, cfg Config) *Server {
	secret := []byte(cfg.SessionSecret)
	if len(secret) == 0 {
		secret = make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			log.Fatalf("rand: %v", err)
		}
		log.Print("WARN: SESSION_SECRET пуст — сессии эфемерны (умрут при рестарте)")
	}
	return &Server{store: st, web: cfg.WebRoot, login: cfg.AdminLogin,
		phash: []byte(cfg.AdminPassHash), secret: secret}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /api/levels", s.apiList)
	mux.HandleFunc("GET /api/levels/{id}", s.apiGet)
	mux.HandleFunc("POST /api/admin/login", s.adminLogin)
	mux.HandleFunc("POST /api/admin/logout", s.adminLogout)
	mux.HandleFunc("GET /api/admin/me", s.adminMe)
	mux.Handle("GET /api/admin/levels", s.requireAdmin(http.HandlerFunc(s.adminList)))
	mux.Handle("POST /api/admin/levels", s.requireAdmin(http.HandlerFunc(s.adminCreate)))
	mux.Handle("GET /api/admin/levels/{id}", s.requireAdmin(http.HandlerFunc(s.adminGet)))
	mux.Handle("PUT /api/admin/levels/{id}", s.requireAdmin(http.HandlerFunc(s.adminUpdate)))
	mux.Handle("DELETE /api/admin/levels/{id}", s.requireAdmin(http.HandlerFunc(s.adminDelete)))
	mux.HandleFunc("GET /admin/", s.serveAdmin)
	mux.HandleFunc("GET /", s.serveGame)
	return mux
}

// --- public ---

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	total, published := s.store.Counts()
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "levels": total, "published": published})
}

// apiList — опубликованные уровни для игры (по ord). Формат 1-в-1 с LEVELS в main.js.
func (s *Server) apiList(w http.ResponseWriter, r *http.Request) {
	levels, err := s.store.ListPublished()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "storage error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"levels": levels})
}

func (s *Server) apiGet(w http.ResponseWriter, r *http.Request) {
	l, err := s.store.GetPublished(r.PathValue("id"))
	if err == store.ErrNotFound {
		writeErr(w, http.StatusNotFound, "level not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "storage error")
		return
	}
	writeJSON(w, http.StatusOK, l)
}

// --- admin auth: логин-пароль + подписанная cookie ---

func (s *Server) adminEnabled() bool { return len(s.phash) > 0 }

func (s *Server) adminLogin(w http.ResponseWriter, r *http.Request) {
	if !s.adminEnabled() {
		writeErr(w, http.StatusForbidden, "admin disabled: set ADMIN_PASSWORD_HASH")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxLoginBody)
	var in struct {
		Login    string `json:"login"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "json {login,password} expected")
		return
	}
	if subtle.ConstantTimeCompare([]byte(in.Login), []byte(s.login)) != 1 ||
		bcrypt.CompareHashAndPassword(s.phash, []byte(in.Password)) != nil {
		writeErr(w, http.StatusUnauthorized, "bad login or password")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: auth.CookieName(), Value: auth.Issue(in.Login, s.secret, time.Now()),
		Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode,
		MaxAge: int((7 * 24 * time.Hour).Seconds()),
	})
	writeJSON(w, http.StatusOK, map[string]string{"login": in.Login})
}

func (s *Server) adminLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: auth.CookieName(), Path: "/", MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminMe(w http.ResponseWriter, r *http.Request) {
	login, ok := s.sessionLogin(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "not logged in")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"login": login})
}

func (s *Server) sessionLogin(r *http.Request) (string, bool) {
	c, err := r.Cookie(auth.CookieName())
	if err != nil {
		return "", false
	}
	login, ok := auth.Verify(c.Value, s.secret, time.Now())
	if !ok || login != s.login {
		return "", false
	}
	return login, true
}

func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.adminEnabled() {
			writeErr(w, http.StatusForbidden, "admin disabled: set ADMIN_PASSWORD_HASH")
			return
		}
		if _, ok := s.sessionLogin(r); !ok {
			writeErr(w, http.StatusUnauthorized, "login required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- admin CRUD ---

func (s *Server) adminList(w http.ResponseWriter, r *http.Request) {
	levels, err := s.store.ListAll()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "storage error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"levels": levels})
}

// adminGet отдаёт уровень любого статуса — редактор и тест-драфт (?draft=id).
func (s *Server) adminGet(w http.ResponseWriter, r *http.Request) {
	l, err := s.store.Get(r.PathValue("id"))
	if err == store.ErrNotFound {
		writeErr(w, http.StatusNotFound, "level not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "storage error")
		return
	}
	writeJSON(w, http.StatusOK, l)
}

type levelInput struct {
	Name   string   `json:"name"`
	Slug   string   `json:"slug"`
	Ord    int      `json:"ord"`
	Status string   `json:"status"`
	Pits   [][2]int `json:"pits"`
	Map    []string `json:"map"`
}

// parseLevelInput разбирает тело, проставляет дефолты (slug из имени, status draft),
// запекает pits-хелпер в карту (в хранилище pits всегда []) и гоняет
// структурную валидацию. Возвращает store.Level без ID.
func (s *Server) parseLevelInput(r *http.ResponseWriter, req *http.Request) (store.Level, bool) {
	var l store.Level
	req.Body = http.MaxBytesReader(*r, req.Body, maxLevelBody)
	var in levelInput
	if err := json.NewDecoder(req.Body).Decode(&in); err != nil {
		writeErr(*r, http.StatusBadRequest, "json {name,pits,map,...} expected")
		return l, false
	}
	if in.Status == "" {
		in.Status = validate.StatusDraft
	}
	if in.Status != validate.StatusDraft && in.Status != validate.StatusPublished {
		writeErr(*r, http.StatusBadRequest, "status must be draft or published")
		return l, false
	}
	slug := strings.TrimSpace(in.Slug)
	if slug == "" {
		slug = store.Slugify(in.Name)
	}
	baked := validate.ApplyPits(in.Map, in.Pits)
	if errs := validate.Validate(in.Name, in.Pits, baked); len(errs) > 0 {
		writeJSON(*r, 422, map[string]any{"error": "invalid level", "details": errs})
		return l, false
	}
	l = store.Level{Name: in.Name, Slug: slug, Ord: in.Ord, Status: in.Status,
		Pits: []store.Pit{}, Map: baked}
	return l, true
}

func (s *Server) adminCreate(w http.ResponseWriter, r *http.Request) {
	l, ok := s.parseLevelInput(&w, r)
	if !ok {
		return
	}
	base := l.Slug
	for i := 2; s.store.SlugExists(l.Slug, 0); i++ {
		l.Slug = strings.TrimSuffix(base, "-") + "-" + itoa(i)
	}
	id, err := s.store.Create(l)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "storage error")
		return
	}
	l.ID, _ = id, id
	got, _ := s.store.Get(itoa(int(id)))
	writeJSON(w, http.StatusCreated, got)
}

func (s *Server) adminUpdate(w http.ResponseWriter, r *http.Request) {
	old, err := s.store.Get(r.PathValue("id"))
	if err == store.ErrNotFound {
		writeErr(w, http.StatusNotFound, "level not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "storage error")
		return
	}
	l, ok := s.parseLevelInput(&w, r)
	if !ok {
		return
	}
	if l.Slug != old.Slug && s.store.SlugExists(l.Slug, old.ID) {
		writeErr(w, http.StatusConflict, "slug already taken")
		return
	}
	l.ID = old.ID
	if err := s.store.Update(l); err != nil {
		writeErr(w, http.StatusInternalServerError, "storage error")
		return
	}
	got, _ := s.store.Get(itoa(int(old.ID)))
	writeJSON(w, http.StatusOK, got)
}

func (s *Server) adminDelete(w http.ResponseWriter, r *http.Request) {
	old, err := s.store.Get(r.PathValue("id"))
	if err == store.ErrNotFound {
		writeErr(w, http.StatusNotFound, "level not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "storage error")
		return
	}
	if err := s.store.Delete(old.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, "storage error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- static: игра и админка ---

// serveFile отдаёт файл с кеш-политикой:
//   - html — no-store (иначе браузер держит старый index.html,
//     а за ним тянутся старые css/js без версий — было на проде с тапом по 🌲);
//   - всё с ?v= — immutable на год (версия bump'ается в html при изменениях).
func (s *Server) serveFile(w http.ResponseWriter, r *http.Request, full string) {
	if strings.HasSuffix(full, ".html") {
		w.Header().Set("Cache-Control", "no-store")
	} else if r.URL.Query().Get("v") != "" {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	http.ServeFile(w, r, full)
}

// serveGame отдаёт только белый список файлов игры (не весь webroot:
// рядом лежат исходники server/ с Go-кодом — их наружу нельзя).
func (s *Server) serveGame(w http.ResponseWriter, r *http.Request) {
	p := path.Clean(r.URL.Path)
	switch {
	case p == "/" || p == "/index.html":
		s.serveFile(w, r, s.web+"/index.html")
	case p == "/style.css" || p == "/main.js" || p == "/preview.html":
		s.serveFile(w, r, s.web+p)
	case p == "/assets" || strings.HasPrefix(p, "/assets/"):
		// Без листинга каталогов: точный файл или 404.
		full := s.web + p
		if st, err := os.Stat(full); err != nil || st.IsDir() {
			http.NotFound(w, r)
			return
		}
		s.serveFile(w, r, full)
	default:
		http.NotFound(w, r)
	}
}

// serveAdmin — статика конструктора (/admin/ → index.html редактора).
func (s *Server) serveAdmin(w http.ResponseWriter, r *http.Request) {
	p := path.Clean(strings.TrimPrefix(r.URL.Path, "/admin"))
	if p == "/" || p == "." || p == "/index.html" {
		s.serveFile(w, r, s.web+"/admin/index.html")
		return
	}
	full := s.web + "/admin" + p
	if st, err := os.Stat(full); err != nil || st.IsDir() || strings.Contains(p, "..") {
		http.NotFound(w, r)
		return
	}
	s.serveFile(w, r, full)
}

// --- helpers ---

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
