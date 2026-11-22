package api

import (
	"bytes"
	"context"
	"cost/internal/auth"
	"cost/internal/domain"
	"cost/internal/store"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

// This is a consumer contract over the real API with synthetic Memory data.
// Writes below only seed that in-memory test fixture; MCP never exposes them.
func TestReadOnlyMCPContract(t *testing.T) {
	var fixture struct {
		Entries    domain.EntryPage  `json:"entries"`
		Stats      domain.Stats      `json:"stats"`
		Categories []domain.Category `json:"categories"`
	}
	raw, err := os.ReadFile("../../../mcp/tests/fixtures/cost-api.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	repo := auth.NewMemory()
	h := NewWithAuth(store.NewMemory(), auth.New(repo, fakeWeChat{}))
	call := func(method, path, token, body string, status int, into any) {
		t.Helper()
		r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s: got %d, want %d: %s", method, path, w.Code, status, w.Body.String())
		}
		if into != nil {
			if err := json.Unmarshal(w.Body.Bytes(), into); err != nil {
				t.Fatal(err)
			}
		}
	}
	login := func(code string) string {
		var v struct{ Token string }
		call("POST", "/api/v1/auth/wechat", "", fmt.Sprintf(`{"code":%q,"nickname":"synthetic"}`, code), 200, &v)
		return v.Token
	}
	first, second := login("mcp-owner"), login("mcp-other")
	call("GET", "/api/v1/entries", "", "", 401, nil)
	var categories, repeated []domain.Category
	// The first GET provisions defaults; repeats return the same IDs, not new defaults.
	call("GET", "/api/v1/categories", first, "", 200, &categories)
	call("GET", "/api/v1/categories", first, "", 200, &repeated)
	if len(categories) == 0 || !reflect.DeepEqual(categories, repeated) {
		t.Fatal("default categories must be stable")
	}
	categoryByName := func(cats []domain.Category, name string) int64 {
		for _, c := range cats {
			if c.Name == name {
				return c.ID
			}
		}
		t.Fatalf("missing category %s", name)
		return 0
	}
	dining := categoryByName(categories, "餐饮")
	transport := categoryByName(categories, "交通")
	salary := categoryByName(categories, "工资")
	seed := func(token string, category, amount int64, kind, day, note string) domain.Entry {
		var result domain.Entry
		body := fmt.Sprintf(`{"category_id":%d,"amount_cent":%d,"kind":%q,"occurred_at":%q,"note":%q,"client_request_id":%q}`, category, amount, kind, day, note, note)
		call("POST", "/api/v1/entries", token, body, 201, &result)
		return result
	}
	seed(first, dining, 101, "expense", "2026-11-01T00:00:00+08:00", "synthetic first")
	seed(first, dining, 202, "expense", "2026-11-21T23:59:59+08:00", "synthetic second")
	seed(first, transport, 202, "expense", "2026-11-22T00:00:00+08:00", "synthetic transport")
	seed(first, salary, 500, "income", "2026-11-22T12:00:00+08:00", "synthetic salary")
	deleted := seed(first, dining, 999, "expense", "2026-11-22T13:00:00+08:00", "synthetic deleted")
	call("DELETE", fmt.Sprintf("/api/v1/entries/%d", deleted.ID), first, "", 204, nil)
	seed(first, dining, 777, "expense", "2026-10-31T23:59:59+08:00", "synthetic before")
	seed(first, dining, 888, "expense", "2026-12-01T00:00:00+08:00", "synthetic after")
	var others []domain.Category
	call("GET", "/api/v1/categories", second, "", 200, &others)
	seed(second, categoryByName(others, "餐饮"), 99999, "expense", "2026-11-22T14:00:00+08:00", "synthetic other")
	var page domain.EntryPage
	call("GET", "/api/v1/entries?month=2026-11&page=1&page_size=1", first, "", 200, &page)
	if page.Total != fixture.Entries.Total || page.Page != 1 || page.PageSize != 1 || len(page.Items) != 1 || page.Items[0].Note != fixture.Entries.Items[0].Note {
		t.Fatalf("unexpected page: %+v", page)
	}
	checkSummary := func(got, want domain.Summary) {
		t.Helper()
		if got.Income != want.Income || got.Expense != want.Expense || got.Balance != want.Balance {
			t.Fatalf("summary got %+v want %+v", got, want)
		}
	}
	checkSummary(page.Summary, fixture.Entries.Summary)
	beforeReads := page
	var stats domain.Stats
	call("GET", "/api/v1/stats?range=month&ref=2026-11-22", first, "", 200, &stats)
	if stats.Summary.Income != fixture.Stats.Summary.Income || stats.Summary.Expense != fixture.Stats.Summary.Expense || stats.Summary.Balance != fixture.Stats.Summary.Balance {
		t.Fatalf("unexpected stats summary: %+v", stats.Summary)
	}
	if stats.Start != fixture.Stats.Start || stats.End != fixture.Stats.End || len(stats.Categories) != 2 {
		t.Fatalf("unexpected statistics: %+v", stats)
	}
	// Generated IDs differ between ledgers; compare fixture categories by their names.
	for _, want := range fixture.Stats.Categories {
		name := ""
		for _, c := range fixture.Categories {
			if c.ID == want.CategoryID {
				name = c.Name
			}
		}
		id := categoryByName(categories, name)
		found := false
		for _, got := range stats.Categories {
			if got.CategoryID == id && got.Amount == want.Amount && got.Count == want.Count {
				found = true
			}
		}
		if !found {
			t.Fatalf("missing fixture category %s: %+v", name, stats.Categories)
		}
	}
	call("GET", "/api/v1/entries?month=2026-11&page=1&page_size=1", first, "", 200, &page)
	if !reflect.DeepEqual(beforeReads, page) {
		t.Fatal("read operations changed existing entry or summary")
	}
	call("GET", "/api/v1/entries?start_date=2026-11-22&end_date=2026-11-22&page=1&page_size=100&account_id=0&min_amount_cent=0", first, "", 200, &page)
	if page.Total != 2 || page.Summary.Expense != 202 || page.Summary.Income != 500 {
		t.Fatalf("inclusive end or zero filters broken: %+v", page)
	}
	call("GET", "/api/v1/entries?month=2026-11&page=99&page_size=1", first, "", 200, &page)
	if len(page.Items) != 0 || page.Total != 4 {
		t.Fatalf("empty page lost total: %+v", page)
	}
	call("POST", "/api/v1/auth/logout", first, "", 204, nil)
	call("GET", "/api/v1/stats?range=month", first, "", 401, nil)
	expired := strings.Repeat("e", 64)
	digest := sha256.Sum256([]byte(expired))
	if _, err := repo.Login(context.Background(), "mcp-expired", "synthetic", hex.EncodeToString(digest[:]), time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	call("GET", "/api/v1/entries", expired, "", 401, nil)
}
