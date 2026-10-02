// Package auth — сессия админки на подписанной cookie.
// Без внешних зависимостей: HMAC-SHA256(login + "." + expiry).
// Перезапуск сервера сессии не убивает (нужен только стабильный SESSION_SECRET).
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strconv"
	"strings"
	"time"
)

const cookieName = "manul_admin"

// SessionTTL — сколько живёт логин. Неделя: удобно для редкого редактирования.
const SessionTTL = 7 * 24 * time.Hour

// Issue выписывает значение cookie для логина.
func Issue(login string, secret []byte, now time.Time) string {
	exp := now.Add(SessionTTL).Unix()
	body := login + "." + strconv.FormatInt(exp, 10)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(body))
	return body + "." + hex.EncodeToString(mac.Sum(nil))
}

// CookieName — имя cookie (нужно серверу для logout).
func CookieName() string { return cookieName }

// Verify проверяет значение cookie и возвращает логин.
func Verify(value string, secret []byte, now time.Time) (string, bool) {
	parts := strings.Split(value, ".")
	if len(parts) != 3 {
		return "", false
	}
	body := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(body))
	want := hex.EncodeToString(mac.Sum(nil))
	if subtle.ConstantTimeCompare([]byte(parts[2]), []byte(want)) != 1 {
		return "", false
	}
	exp, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || now.Unix() > exp {
		return "", false
	}
	if parts[0] == "" {
		return "", false
	}
	return parts[0], true
}
