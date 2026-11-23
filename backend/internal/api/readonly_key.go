package api

import (
	"cost/internal/auth"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"strings"
)

// WithReadOnlyKey admits a static bearer key as userID for GET and HEAD requests.
// Only the SHA-256 hex digest of the key reaches the process, never the plaintext.
func WithReadOnlyKey(sha256Hex string, userID int64) Option {
	return func(a *API) {
		sum, err := hex.DecodeString(sha256Hex)
		if sha256Hex == "" || err != nil || len(sum) != sha256.Size || userID < 1 {
			return
		}
		a.keyHash = sum
		a.keyUser = userID
	}
}

func (a *API) keyPrincipal(r *http.Request) (auth.Principal, bool) {
	if a.keyHash == nil {
		return auth.Principal{}, false
	}
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return auth.Principal{}, false
	}
	sum := sha256.Sum256([]byte(strings.TrimPrefix(header, "Bearer ")))
	if subtle.ConstantTimeCompare(sum[:], a.keyHash) != 1 {
		return auth.Principal{}, false
	}
	return auth.Principal{ID: a.keyUser}, true
}
