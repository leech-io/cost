package api

import (
	"context"
	"cost/internal/auth"
	"cost/internal/domain"
	"cost/internal/store"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"time"
)

type API struct {
	store      store.Store
	token      string
	keyHash    []byte
	keyUser    int64
	cache      ReferenceCache
	generation referenceGeneration
}

// New enables the explicit local-development token used by existing tests.
func New(s store.Store, token string, opts ...Option) http.Handler {
	return newHandler(s, token, nil, opts...)
}
func NewWithAuth(s store.Store, service *auth.Service, opts ...Option) http.Handler {
	return newHandler(s, "", service, opts...)
}
func newHandler(s store.Store, token string, service *auth.Service, opts ...Option) http.Handler {
	a := &API{store: s, token: token}
	for _, opt := range opts {
		opt(a)
	}
	a.initReferenceCache()
	mux := http.NewServeMux()
	if service != nil {
		service.Register(mux)
	}
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]string{"status": "ok", "auth_mode": func() string {
			if service != nil {
				return "wechat"
			}
			return "local-development"
		}()})
	})
	mux.HandleFunc("GET /api/v1/categories", a.categories)
	mux.HandleFunc("POST /api/v1/categories", a.createCategory)
	mux.HandleFunc("POST /api/v1/categories/system-icons", a.unifySystemIcons)
	mux.HandleFunc("PATCH /api/v1/categories/{id}", a.updateCategory)
	mux.HandleFunc("GET /api/v1/accounts", a.accounts)
	mux.HandleFunc("POST /api/v1/accounts", a.createAccount)
	mux.HandleFunc("PATCH /api/v1/accounts/{id}", a.updateAccount)
	mux.HandleFunc("GET /api/v1/transfers", a.transfers)
	mux.HandleFunc("POST /api/v1/transfers", a.createTransfer)
	mux.HandleFunc("DELETE /api/v1/transfers/{id}", a.deleteTransfer)
	mux.HandleFunc("GET /api/v1/entry-authors", a.authors)
	mux.HandleFunc("GET /api/v1/entries", a.filteredList)
	mux.HandleFunc("POST /api/v1/entries", a.create)
	mux.HandleFunc("GET /api/v1/entries/{id}", a.entry)
	mux.HandleFunc("POST /api/v1/entries/{id}/restore", a.restore)
	mux.HandleFunc("PATCH /api/v1/entries/{id}", a.update)
	mux.HandleFunc("DELETE /api/v1/entries/{id}", a.delete)
	mux.HandleFunc("GET /api/v1/stats", a.stats)
	mux.HandleFunc("GET /api/v1/budgets", a.budgets)
	mux.HandleFunc("PUT /api/v1/budgets", a.setBudget)
	mux.HandleFunc("GET /api/v1/ledgers/me", a.ledgerMe)
	mux.HandleFunc("PATCH /api/v1/ledgers/me", a.updateLedger)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		path := r.URL.Path
		if auth.PublicAvatarRequest(r) {
			path = "/api/v1/avatars/{avatar}"
		}
		defer func() { slog.Info("request", "method", r.Method, "path", path, "duration", time.Since(start)) }()
		defer func() {
			if v := recover(); v != nil {
				slog.Error("panic", "error", v)
				respond(w, 500, map[string]string{"error": "internal_error"})
			}
		}()
		if r.URL.Path != "/health" && !(service != nil && auth.PublicAvatarRequest(r)) {
			if service != nil {
				if r.URL.Path != "/api/v1/auth/wechat" {
					if p, ok := a.keyPrincipal(r); ok {
						if r.Method != http.MethodGet && r.Method != http.MethodHead {
							respond(w, 403, map[string]string{"error": "read_only_key"})
							return
						}
						ledgerID, err := a.store.LedgerForUser(r.Context(), p.ID)
						if err != nil {
							slog.Error("ledger resolve", "error", err)
							respond(w, 500, map[string]string{"error": "internal_error"})
							return
						}
						ctx := auth.WithPrincipal(r.Context(), p)
						r = r.WithContext(store.WithLedgerID(ctx, ledgerID))
					} else {
						p, err := service.Authenticate(r)
						if err != nil {
							status, code := 401, "unauthorized"
							if !errors.Is(err, auth.ErrUnauthorized) {
								status, code = 503, "authentication_unavailable"
							}
							respond(w, status, map[string]string{"error": code})
							return
						}
						profileRoute := r.URL.Path == "/api/v1/auth/me" || r.URL.Path == "/api/v1/auth/me/avatar" || r.URL.Path == "/api/v1/auth/logout"
						if p.Nickname == "" && !profileRoute {
							respond(w, 403, map[string]string{"error": "nickname_required"})
							return
						}
						ledgerID, err := a.store.LedgerForUser(r.Context(), p.ID)
						if err != nil {
							slog.Error("ledger resolve", "error", err)
							respond(w, 500, map[string]string{"error": "internal_error"})
							return
						}
						ctx := auth.WithPrincipal(r.Context(), p)
						r = r.WithContext(store.WithLedgerID(ctx, ledgerID))
					}
				}
			} else {
				if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Dev-Token")), []byte(a.token)) != 1 {
					respond(w, 401, map[string]string{"error": "unauthorized"})
					return
				}
				r = r.WithContext(store.WithLedgerID(auth.WithPrincipal(r.Context(), auth.Principal{}), 1))
			}
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		mux.ServeHTTP(w, r.WithContext(ctx))
	})
}
func respond(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
func fail(w http.ResponseWriter, err error) {
	status, code := 500, "internal_error"
	switch {
	case errors.Is(err, domain.ErrNotFound):
		status, code = 404, "not_found"
	case errors.Is(err, domain.ErrConflict):
		status, code = 409, "request_conflict"
	case errors.Is(err, domain.ErrInvalidRange):
		status, code = 400, "invalid_range"
	case errors.Is(err, domain.ErrInvalidBudget):
		status, code = 400, "invalid_budget"
	case errors.Is(err, domain.ErrInvalid):
		status, code = 400, "invalid_entry"
	}
	if status == 500 {
		slog.Error("storage error", "error", err)
	}
	respond(w, status, map[string]string{"error": code})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		respond(w, 400, map[string]string{"error": "invalid_json"})
		return false
	}
	if err := d.Decode(new(any)); err != io.EOF {
		respond(w, 400, map[string]string{"error": "invalid_json"})
		return false
	}
	return true
}
func (a *API) categories(w http.ResponseWriter, r *http.Request) {
	referenceRead(a, w, r, "categories", func() ([]domain.Category, error) { return a.store.Categories(r.Context()) })
}
func (a *API) valid(r *http.Request, e domain.Entry) error {
	c, err := a.store.Categories(r.Context())
	if err != nil {
		return err
	}
	return domain.Validate(e, c)
}
func (a *API) create(w http.ResponseWriter, r *http.Request) {
	var e domain.Entry
	if !decode(w, r, &e) {
		return
	}
	e.ID = 0
	e.CreatedBy = auth.Current(r.Context()).ID
	e.OccurredAt = e.OccurredAt.Truncate(time.Microsecond)
	if e.Currency == "" {
		e.Currency = "CNY"
	}
	if err := a.valid(r, e); err != nil {
		fail(w, err)
		return
	}
	out, created, err := a.store.Save(r.Context(), e)
	if err != nil {
		fail(w, err)
		return
	}
	status := 200
	if created {
		status = 201
	}
	respond(w, status, out)
}
func id(r *http.Request) (int64, error) {
	n, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || n <= 0 {
		return 0, domain.ErrInvalid
	}
	return n, nil
}
func (a *API) update(w http.ResponseWriter, r *http.Request) {
	var patch struct {
		domain.Entry
		AccountID     *int64  `json:"account_id"`
		RefundOfID    *int64  `json:"refund_of_id"`
		Reimbursable  *bool   `json:"reimbursable"`
		ExcludeStats  *bool   `json:"exclude_stats"`
		ExcludeBudget *bool   `json:"exclude_budget"`
		Currency      *string `json:"currency"`
	}
	if !decode(w, r, &patch) {
		return
	}
	n, err := id(r)
	if err != nil {
		fail(w, err)
		return
	}
	old, err := a.store.Get(r.Context(), n)
	if err != nil {
		fail(w, err)
		return
	}
	e := patch.Entry
	e.AccountID, e.RefundOfID, e.Reimbursable = old.AccountID, old.RefundOfID, old.Reimbursable
	e.ExcludeStats, e.ExcludeBudget, e.Currency = old.ExcludeStats, old.ExcludeBudget, old.Currency
	if patch.AccountID != nil {
		e.AccountID = *patch.AccountID
	}
	if patch.RefundOfID != nil {
		e.RefundOfID = *patch.RefundOfID
	}
	if patch.Reimbursable != nil {
		e.Reimbursable = *patch.Reimbursable
	}
	if patch.ExcludeStats != nil {
		e.ExcludeStats = *patch.ExcludeStats
	}
	if patch.ExcludeBudget != nil {
		e.ExcludeBudget = *patch.ExcludeBudget
	}
	if patch.Currency != nil {
		e.Currency = *patch.Currency
	}
	e.CreatedBy = old.CreatedBy
	e.ID = n
	e.OccurredAt = e.OccurredAt.Truncate(time.Microsecond)
	e.RequestID = "update"
	if e.Currency == "" {
		e.Currency = "CNY"
	}
	if err = a.valid(r, e); err != nil {
		fail(w, err)
		return
	}
	out, err := a.store.Update(r.Context(), e)
	if err != nil {
		fail(w, err)
		return
	}
	respond(w, 200, out)
}
func (a *API) delete(w http.ResponseWriter, r *http.Request) {
	n, err := id(r)
	if err != nil {
		fail(w, err)
		return
	}
	if _, readErr := a.store.Get(r.Context(), n); readErr != nil {
		fail(w, readErr)
		return
	}
	if err = a.store.Delete(r.Context(), n); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(204)
}
func (a *API) stats(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	kind := q.Get("range")
	if kind == "" {
		kind = domain.RangeMonth
	}
	rng, err := domain.NewRange(kind, q.Get("ref"), q.Get("start_date"), q.Get("end_date"), time.Now())
	if err != nil {
		fail(w, err)
		return
	}
	entries, err := a.store.List(r.Context(), rng.Start, rng.End)
	if err != nil {
		fail(w, err)
		return
	}
	var budgetTotal *int64
	if rng.Kind == domain.RangeMonth {
		rows, err := a.store.Budgets(r.Context(), domain.BudgetScopeMonth, domain.MonthPeriodKey(rng.Start))
		if err != nil {
			fail(w, err)
			return
		}
		for _, row := range rows {
			if row.CategoryID == 0 {
				v := row.Amount
				budgetTotal = &v
			}
		}
	}
	s := domain.StatsFrom(rng, entries, budgetTotal, time.Now())
	sort.Slice(s.Categories, func(i, j int) bool { return s.Categories[i].Amount > s.Categories[j].Amount })
	respond(w, 200, s)
}
func (a *API) budgets(w http.ResponseWriter, r *http.Request) {
	scope, period := r.URL.Query().Get("scope"), r.URL.Query().Get("period")
	start, end, err := domain.PeriodBounds(scope, period)
	if err != nil {
		fail(w, err)
		return
	}
	rows, err := a.store.Budgets(r.Context(), scope, period)
	if err != nil {
		fail(w, err)
		return
	}
	cats, err := a.store.Categories(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	entries, err := a.store.List(r.Context(), start, end)
	if err != nil {
		fail(w, err)
		return
	}
	spent := map[int64]int64{}
	for _, e := range entries {
		if e.Kind == "expense" {
			spent[e.CategoryID] += e.Amount
		}
	}
	type categoryBudget struct {
		CategoryID int64  `json:"category_id"`
		Name       string `json:"name"`
		Icon       string `json:"icon"`
		IconKey    string `json:"icon_key"`
		Amount     int64  `json:"amount_cent"`
		Spent      int64  `json:"spent_cent"`
		IsSet      bool   `json:"is_set"`
	}
	out := struct {
		Scope      string           `json:"scope"`
		Period     string           `json:"period"`
		Total      *int64           `json:"total_cent"`
		Categories []categoryBudget `json:"categories"`
	}{Scope: scope, Period: period, Categories: []categoryBudget{}}
	settings := map[int64]int64{}
	for _, row := range rows {
		if row.CategoryID == 0 {
			v := row.Amount
			out.Total = &v
		} else {
			settings[row.CategoryID] = row.Amount
		}
	}
	for _, c := range cats {
		if c.Kind != "expense" {
			continue
		}
		amount, set := settings[c.ID]
		out.Categories = append(out.Categories, categoryBudget{CategoryID: c.ID, Name: c.Name, Icon: c.Icon, IconKey: c.IconKey, Amount: amount, Spent: spent[c.ID], IsSet: set})
	}
	respond(w, 200, out)
}
func (a *API) setBudget(w http.ResponseWriter, r *http.Request) {
	var row domain.BudgetRow
	if !decode(w, r, &row) {
		return
	}
	if err := domain.ValidateBudgetRow(row); err != nil {
		fail(w, err)
		return
	}
	if err := a.store.SetBudget(r.Context(), row); err != nil {
		fail(w, err)
		return
	}
	respond(w, 200, row)
}
func (a *API) ledgerMe(w http.ResponseWriter, r *http.Request) {
	referenceRead(a, w, r, "profile", func() (domain.Ledger, error) { return a.store.Ledger(r.Context(), store.LedgerID(r.Context())) })
}

func (a *API) entry(w http.ResponseWriter, r *http.Request) {
	n, err := id(r)
	if err != nil {
		fail(w, err)
		return
	}
	e, err := a.store.Get(r.Context(), n)
	if err != nil {
		fail(w, err)
		return
	}
	respond(w, 200, e)
}
func (a *API) restore(w http.ResponseWriter, r *http.Request) {
	n, err := id(r)
	if err != nil {
		fail(w, err)
		return
	}
	if err = a.store.Restore(r.Context(), n); err != nil {
		fail(w, err)
		return
	}
	e, err := a.store.Get(r.Context(), n)
	if err != nil {
		fail(w, err)
		return
	}
	respond(w, 200, e)
}
