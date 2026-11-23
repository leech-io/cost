package api

import (
	"cost/internal/auth"
	"cost/internal/store"
	"crypto/sha256"
	"encoding/hex"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReadOnlyKeyAuthentication(t *testing.T) {
	key := strings.Repeat("ab", 32)
	sum := sha256.Sum256([]byte(key))
	h := NewWithAuth(store.NewMemory(), auth.New(auth.NewMemory(), fakeWeChat{}), WithReadOnlyKey(hex.EncodeToString(sum[:]), 1))
	call := func(method, path, token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := call("GET", "/api/v1/categories", key); w.Code != 200 {
		t.Fatalf("read-only key GET = %d: %s", w.Code, w.Body.String())
	}
	if w := call("GET", "/api/v1/categories", strings.Repeat("f", 64)); w.Code != 401 {
		t.Fatalf("wrong key GET = %d: %s", w.Code, w.Body.String())
	}
	if w := call("GET", "/api/v1/categories", ""); w.Code != 401 {
		t.Fatalf("missing key GET = %d: %s", w.Code, w.Body.String())
	}
	if w := call("POST", "/api/v1/categories", key); w.Code != 403 || !strings.Contains(w.Body.String(), "read_only_key") {
		t.Fatalf("read-only key POST = %d: %s", w.Code, w.Body.String())
	}
}
