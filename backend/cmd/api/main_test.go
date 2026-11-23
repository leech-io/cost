package main

import (
	"strings"
	"testing"
)

func lookup(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestLoadConfig(t *testing.T) {
	production := map[string]string{
		"COST_ENV":          "production",
		"COST_STORE":        "mysql",
		"COST_MYSQL_DSN":    "cost:secret@tcp(127.0.0.1:3306)/cost",
		"COST_AUTH_MODE":    "wechat",
		"WECHAT_APP_ID":     "wx-app",
		"WECHAT_APP_SECRET": "wx-secret",
	}
	prod := func(extra map[string]string) map[string]string {
		env := make(map[string]string, len(production)+len(extra))
		for k, v := range production {
			env[k] = v
		}
		for k, v := range extra {
			env[k] = v
		}
		return env
	}
	sha := strings.Repeat("ab", 32)
	tests := []struct {
		name      string
		env       map[string]string
		migrate   bool
		wantErr   string
		wantStore string
		wantAuth  string
		wantAddr  string
		wantKey   bool
	}{
		{
			name:      "local defaults are usable",
			env:       map[string]string{"COST_AUTH_MODE": "development"},
			wantStore: "memory",
			wantAuth:  "development",
			wantAddr:  "0.0.0.0:8080",
		},
		{
			name:      "production wechat mysql",
			env:       production,
			wantStore: "mysql",
			wantAuth:  "wechat",
			wantAddr:  "0.0.0.0:8080",
		},
		{
			name:    "unknown environment",
			env:     map[string]string{"COST_ENV": "staging", "COST_AUTH_MODE": "development"},
			wantErr: "COST_ENV",
		},
		{
			name: "production requires mysql",
			env: map[string]string{
				"COST_ENV":          "production",
				"COST_STORE":        "memory",
				"COST_AUTH_MODE":    "wechat",
				"WECHAT_APP_ID":     "wx-app",
				"WECHAT_APP_SECRET": "wx-secret",
			},
			wantErr: "production requires MySQL",
		},
		{
			name:    "mysql requires dsn",
			env:     map[string]string{"COST_STORE": "mysql", "COST_AUTH_MODE": "development"},
			wantErr: "COST_MYSQL_DSN",
		},
		{
			name:    "unknown store",
			env:     map[string]string{"COST_STORE": "sqlite", "COST_AUTH_MODE": "development"},
			wantErr: "COST_STORE",
		},
		{
			name:    "unknown auth mode",
			env:     map[string]string{"COST_AUTH_MODE": "password"},
			wantErr: "COST_AUTH_MODE",
		},
		{
			name: "wechat requires credentials",
			env: map[string]string{
				"COST_STORE":     "mysql",
				"COST_MYSQL_DSN": "dsn",
				"COST_AUTH_MODE": "wechat",
			},
			wantErr: "WECHAT_APP_ID",
		},
		{
			name: "development auth is forbidden in production",
			env: map[string]string{
				"COST_ENV":       "production",
				"COST_STORE":     "mysql",
				"COST_MYSQL_DSN": "dsn",
				"COST_AUTH_MODE": "development",
			},
			wantErr: "forbidden in production",
		},
		{
			name:      "migration only needs store configuration",
			env:       map[string]string{"COST_STORE": "mysql", "COST_MYSQL_DSN": "dsn"},
			migrate:   true,
			wantStore: "mysql",
			wantAuth:  "wechat",
			wantAddr:  "0.0.0.0:8080",
		},
		{
			name:      "read-only key alongside wechat",
			env:       prod(map[string]string{"COST_APIKEY_SHA256": sha}),
			wantStore: "mysql",
			wantAuth:  "wechat",
			wantAddr:  "0.0.0.0:8080",
			wantKey:   true,
		},
		{
			name:    "read-only key must be a sha256 digest",
			env:     prod(map[string]string{"COST_APIKEY_SHA256": "deadbeef"}),
			wantErr: "COST_APIKEY_SHA256",
		},
		{
			name:    "read-only key requires wechat mode",
			env:     map[string]string{"COST_AUTH_MODE": "development", "COST_APIKEY_SHA256": sha},
			wantErr: "requires COST_AUTH_MODE=wechat",
		},
		{
			name:    "read-only key user id must be positive",
			env:     prod(map[string]string{"COST_APIKEY_SHA256": sha, "COST_APIKEY_USER_ID": "0"}),
			wantErr: "COST_APIKEY_USER_ID",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := loadConfig(lookup(tt.env), tt.migrate)
			if tt.wantErr != "" {
				if err == nil {
					t.Fatalf("loadConfig() = nil error, want error containing %q", tt.wantErr)
				}
				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("loadConfig() error = %q, want it to contain %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("loadConfig() unexpected error: %v", err)
			}
			if cfg.store != tt.wantStore || cfg.authMode != tt.wantAuth || cfg.addr != tt.wantAddr || (cfg.apiKeySHA256 != "") != tt.wantKey {
				t.Fatalf("loadConfig() = %+v, want store=%q auth=%q addr=%q key=%v", cfg, tt.wantStore, tt.wantAuth, tt.wantAddr, tt.wantKey)
			}
		})
	}
}

func TestRedisConfig(t *testing.T) {
	for _, tt := range []struct {
		name, addr, password string
		migrate              bool
		wantError            bool
	}{
		{name: "disabled"},
		{name: "enabled", addr: "cost-redis:6379", password: "test-only-password"},
		{name: "missing password", addr: "cost-redis:6379", wantError: true},
		{name: "missing address", password: "test-only-password", wantError: true},
		{name: "url instead of address", addr: "redis://cost-redis:6379", password: "test-only-password", wantError: true},
		{name: "invalid port", addr: "cost-redis:abc", password: "test-only-password", wantError: true},
		{name: "migration ignores cache", addr: "bad-address", migrate: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := loadConfig(lookup(map[string]string{"COST_AUTH_MODE": "development", "COST_REDIS_ADDR": tt.addr, "COST_REDIS_PASSWORD": tt.password}), tt.migrate)
			if tt.wantError {
				if err == nil || strings.Contains(err.Error(), "test-only-password") {
					t.Fatalf("want safe Redis configuration error, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !tt.migrate && (cfg.redisAddr != tt.addr || cfg.redisPassword != tt.password) {
				t.Fatal("redis configuration was not loaded")
			}
		})
	}
}
