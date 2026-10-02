package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"golang.org/x/crypto/bcrypt"

	"manul-server/server"
	"manul-server/store"
)

func main() {
	healthcheck := flag.Bool("healthcheck", false, "probe http://127.0.0.1:$PORT/healthz and exit (for Docker HEALTHCHECK)")
	hashpass := flag.String("hashpass", "", "print bcrypt hash of the given password and exit (to fill ADMIN_PASSWORD_HASH)")
	flag.Parse()

	if *healthcheck {
		os.Exit(runHealthcheck())
	}
	if *hashpass != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(*hashpass), bcrypt.DefaultCost)
		if err != nil {
			log.Fatalf("hash: %v", err)
		}
		fmt.Println(string(hash))
		return
	}

	cfg := loadConfig()
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		log.Fatalf("data dir: %v", err)
	}
	st, err := store.Open(cfg.DataDir + "/manul.db")
	if err != nil {
		log.Fatalf("storage: %v", err)
	}
	defer st.Close()
	levels, published := st.Counts()
	srv := server.New(st, server.Config{
		WebRoot:       cfg.WebRoot,
		AdminLogin:    cfg.AdminLogin,
		AdminPassHash: cfg.AdminPassHash,
		SessionSecret: cfg.SessionSecret,
	})

	httpServer := &http.Server{
		Addr:              net.JoinHostPort("", cfg.Port),
		Handler:           srv.Handler(),
		ReadTimeout:       15 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		adminState := "admin=off (set ADMIN_PASSWORD_HASH to enable)"
		if cfg.AdminPassHash != "" {
			adminState = "admin=on login=" + cfg.AdminLogin
		}
		log.Printf("listening :%s webroot=%s levels=%d published=%d %s",
			cfg.Port, cfg.WebRoot, levels, published, adminState)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Print("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

func runHealthcheck() int {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/healthz")
	if err != nil {
		fmt.Fprintf(os.Stderr, "healthcheck: %v\n", err)
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "healthcheck: status %d\n", resp.StatusCode)
		return 1
	}
	return 0
}

func getenvTrim(key string) string {
	return strings.TrimSpace(os.Getenv(key))
}
