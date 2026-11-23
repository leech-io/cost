package main

import (
	"context"
	"cost/internal/api"
	"cost/internal/auth"
	"cost/internal/cache"
	"cost/internal/store"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata"
)

type config struct {
	env           string
	store         string
	authMode      string
	addr          string
	dsn           string
	devToken      string
	appID         string
	appSecret     string
	apiKeySHA256  string
	apiKeyUserID  int64
	redisAddr     string
	redisPassword string
}

// loadConfig validates startup configuration before any connection is opened.
// A migration run only touches storage, so it does not require login credentials.
func loadConfig(getenv func(string) string, migrate bool) (config, error) {
	pick := func(key, fallback string) string {
		if s := getenv(key); s != "" {
			return s
		}
		return fallback
	}
	cfg := config{
		env:           pick("COST_ENV", "development"),
		store:         pick("COST_STORE", "memory"),
		authMode:      pick("COST_AUTH_MODE", "wechat"),
		addr:          pick("COST_ADDR", "0.0.0.0:8080"),
		dsn:           getenv("COST_MYSQL_DSN"),
		devToken:      pick("COST_DEV_TOKEN", "cost-local-dev"),
		appID:         getenv("WECHAT_APP_ID"),
		appSecret:     getenv("WECHAT_APP_SECRET"),
		apiKeySHA256:  strings.ToLower(getenv("COST_APIKEY_SHA256")),
		apiKeyUserID:  1,
		redisAddr:     getenv("COST_REDIS_ADDR"),
		redisPassword: getenv("COST_REDIS_PASSWORD"),
	}
	if raw := getenv("COST_APIKEY_USER_ID"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || id < 1 {
			return config{}, errors.New("COST_APIKEY_USER_ID must be a positive integer")
		}
		cfg.apiKeyUserID = id
	}
	if cfg.env != "development" && cfg.env != "production" {
		return config{}, fmt.Errorf("COST_ENV must be development or production, got %q", cfg.env)
	}
	switch cfg.store {
	case "memory":
		if cfg.env == "production" {
			return config{}, errors.New("production requires MySQL")
		}
	case "mysql":
		if cfg.dsn == "" {
			return config{}, errors.New("COST_MYSQL_DSN is required")
		}
	default:
		return config{}, errors.New("COST_STORE must be memory or mysql")
	}
	if migrate {
		return cfg, nil
	}
	if (cfg.redisAddr == "") != (cfg.redisPassword == "") {
		return config{}, errors.New("COST_REDIS_ADDR and COST_REDIS_PASSWORD must both be set")
	}
	if cfg.redisAddr != "" {
		host, port, err := net.SplitHostPort(cfg.redisAddr)
		n, parseErr := strconv.Atoi(port)
		if err != nil || host == "" || parseErr != nil || n < 1 || n > 65535 {
			return config{}, errors.New("COST_REDIS_ADDR must be host:port")
		}
	}
	switch cfg.authMode {
	case "wechat":
		if cfg.appID == "" || cfg.appSecret == "" {
			return config{}, errors.New("WECHAT_APP_ID and WECHAT_APP_SECRET are required for wechat authentication")
		}
	case "development":
		if cfg.env == "production" {
			return config{}, errors.New("development authentication is forbidden in production")
		}
	default:
		return config{}, fmt.Errorf("unknown COST_AUTH_MODE %q", cfg.authMode)
	}
	if cfg.apiKeySHA256 != "" {
		sum, err := hex.DecodeString(cfg.apiKeySHA256)
		if err != nil || len(sum) != sha256.Size {
			return config{}, errors.New("COST_APIKEY_SHA256 must be a 64-character hex SHA-256 digest")
		}
		if cfg.authMode != "wechat" {
			return config{}, errors.New("COST_APIKEY_SHA256 requires COST_AUTH_MODE=wechat")
		}
	}
	return cfg, nil
}
func main() {
	if err := run(); err != nil {
		slog.Error("exit", "error", err)
		os.Exit(1)
	}
}
func run() error {
	migrate := flag.Bool("migrate", false, "initialize MySQL schema and exit")
	flag.Parse()
	cfg, err := loadConfig(os.Getenv, *migrate)
	if err != nil {
		return err
	}
	timeout := 15 * time.Second
	if *migrate {
		timeout = 5 * time.Minute
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	var s store.Store
	var identities auth.Repository
	switch cfg.store {
	case "memory":
		if *migrate {
			return errors.New("-migrate requires COST_STORE=mysql")
		}
		s = store.NewMemory()
		identities = auth.NewMemory()
	case "mysql":
		db, err := store.NewMySQL(ctx, cfg.dsn)
		if err != nil {
			return err
		}
		s = db
		identities = &auth.MySQL{DB: db.DB()}
		if *migrate {
			defer db.Close()
			return db.Migrate(ctx)
		}
	}
	defer s.Close()
	var options []api.Option
	if cfg.redisAddr != "" {
		client := cache.NewRedis(cfg.redisAddr, cfg.redisPassword)
		defer client.Close()
		options = append(options, api.WithReferenceCache(client))
	}
	if cfg.apiKeySHA256 != "" {
		options = append(options, api.WithReadOnlyKey(cfg.apiKeySHA256, cfg.apiKeyUserID))
	}
	var handler http.Handler
	switch cfg.authMode {
	case "wechat":
		handler = api.NewWithAuth(s, auth.New(identities, auth.WeChat{AppID: cfg.appID, Secret: cfg.appSecret}), options...)
	case "development":
		handler = api.New(s, cfg.devToken, options...)
	}
	server := &http.Server{Addr: cfg.addr, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	slog.Info("starting cost", "env", cfg.env, "store", cfg.store, "auth_mode", cfg.authMode, "addr", server.Addr, "reference_cache", cfg.redisAddr != "", "read_only_key", cfg.apiKeySHA256 != "")
	if cfg.authMode == "development" {
		slog.Warn("development token authentication: local use only")
	}
	if cfg.store == "memory" {
		slog.Warn("memory mode: data is lost when the process exits")
	}
	stop, done := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer done()
	result := make(chan error, 1)
	go func() { result <- server.ListenAndServe() }()
	select {
	case err := <-result:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-stop.Done():
	}
	shutdown, cancelShutdown := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelShutdown()
	if err := server.Shutdown(shutdown); err != nil {
		_ = server.Close()
		return err
	}
	return nil
}
