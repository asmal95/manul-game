package main

// Config собирается из env. Дефолты позволяют поднять сервис локально
// без настроек: `go run .` из каталога server/ (WEBROOT=.. — корень игры).
// Админка выключена, пока не задан ADMIN_PASSWORD_HASH (fail closed).
type Config struct {
	Port          string
	DataDir       string
	WebRoot       string
	AdminLogin    string
	AdminPassHash string
	SessionSecret string
}

func loadConfig() Config {
	return Config{
		Port:          envOr("PORT", "8080"),
		DataDir:       envOr("DATA_DIR", "./data"),
		WebRoot:       envOr("WEBROOT", ".."),
		AdminLogin:    envOr("ADMIN_LOGIN", "admin"),
		AdminPassHash: envOr("ADMIN_PASSWORD_HASH", ""),
		SessionSecret: envOr("SESSION_SECRET", ""),
	}
}

func envOr(key, def string) string {
	if v := getenvTrim(key); v != "" {
		return v
	}
	return def
}
