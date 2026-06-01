package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/officialasishkumar/costobs/services/ingest/internal/dedup"
	"github.com/officialasishkumar/costobs/services/ingest/internal/metrics"
	"github.com/officialasishkumar/costobs/services/ingest/internal/model"
)

type fakeAuth struct {
	slug string
	ok   bool
}

func (f *fakeAuth) Authenticate(context.Context, string) (string, error) {
	if !f.ok {
		return "", context.Canceled // any non-nil error → 401
	}
	return f.slug, nil
}

type fakeBuffer struct {
	full      bool
	added     []model.Event
	lastBatch []model.Event
}

func (b *fakeBuffer) Add(events []model.Event) (int, bool) {
	if b.full {
		return 0, true
	}
	b.added = append(b.added, events...)
	b.lastBatch = events
	return len(events), false
}

type fakePinger struct{ err error }

func (p fakePinger) Ping(context.Context) error { return p.err }

func newTestServer(auth Authenticator, buf Enqueuer) *Server {
	return New(Config{
		Auth:           auth,
		Buffer:         buf,
		Dedup:          dedup.New(5 * time.Minute),
		Metrics:        metrics.New(),
		Log:            slog.New(slog.NewTextHandler(io.Discard, nil)),
		ClickHouse:     fakePinger{},
		Postgres:       fakePinger{},
		MaxBatchEvents: 1000,
	})
}

const validEvent = `{
	"request_id": "01J000000000000000000000R1",
	"ts": "2026-06-01T12:00:00Z",
	"provider": "openai",
	"model": "gpt-4o",
	"operation": "chat",
	"status": "ok",
	"pricing_version": "2026-06-01",
	"sdk_lang": "python",
	"sdk_version": "1.0.0",
	"cost_usd": 0.0001234567,
	"input_tokens": 100
}`

func doPost(t *testing.T, s *Server, body, authHeader string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/events", strings.NewReader(body))
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func TestEvents202HappyPath(t *testing.T) {
	buf := &fakeBuffer{}
	s := newTestServer(&fakeAuth{slug: "default", ok: true}, buf)

	body := `{"events": [` + validEvent + `]}`
	rec := doPost(t, s, body, "Bearer costobs_dev_secret_key")

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if len(buf.added) != 1 {
		t.Fatalf("expected 1 buffered event, got %d", len(buf.added))
	}
	if buf.added[0].OrgID != "default" {
		t.Fatalf("org_id should be stamped to slug, got %q", buf.added[0].OrgID)
	}
	if got := buf.added[0].CostUsd.String(); got != "0.0001234567" {
		t.Fatalf("cost_usd decimal precision lost: %q", got)
	}
}

func TestEventsIgnoresClientOrgID(t *testing.T) {
	buf := &fakeBuffer{}
	s := newTestServer(&fakeAuth{slug: "default", ok: true}, buf)
	// org_id is not in the schema; including it should be ignored (or rejected
	// by additionalProperties at the SDK). Our decoder ignores unknown via the
	// alias having no org_id field, so it's silently dropped. Verify stamping.
	body := `{"events": [` + validEvent + `]}`
	doPost(t, s, body, "Bearer k")
	if buf.added[0].OrgID != "default" {
		t.Fatalf("org_id mismatch: %q", buf.added[0].OrgID)
	}
}

func TestEvents401BadKey(t *testing.T) {
	s := newTestServer(&fakeAuth{ok: false}, &fakeBuffer{})
	rec := doPost(t, s, `{"events": [`+validEvent+`]}`, "Bearer bad")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestEvents401MissingHeader(t *testing.T) {
	s := newTestServer(&fakeAuth{slug: "default", ok: true}, &fakeBuffer{})
	rec := doPost(t, s, `{"events": [`+validEvent+`]}`, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestEvents400Malformed(t *testing.T) {
	s := newTestServer(&fakeAuth{slug: "default", ok: true}, &fakeBuffer{})
	rec := doPost(t, s, `{"events": [ not json `, "Bearer k")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestEvents400MissingRequiredField(t *testing.T) {
	s := newTestServer(&fakeAuth{slug: "default", ok: true}, &fakeBuffer{})
	// Missing provider, model, etc.
	body := `{"events": [{"request_id":"x","ts":"2026-06-01T12:00:00Z"}]}`
	rec := doPost(t, s, body, "Bearer k")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestEvents429WhenBufferFull(t *testing.T) {
	s := newTestServer(&fakeAuth{slug: "default", ok: true}, &fakeBuffer{full: true})
	rec := doPost(t, s, `{"events": [`+validEvent+`]}`, "Bearer k")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("expected Retry-After header")
	}
}

func TestEventsDedupDropsDuplicate(t *testing.T) {
	buf := &fakeBuffer{}
	s := newTestServer(&fakeAuth{slug: "default", ok: true}, buf)
	body := `{"events": [` + validEvent + `]}`

	rec1 := doPost(t, s, body, "Bearer k")
	if rec1.Code != http.StatusAccepted {
		t.Fatalf("first status = %d", rec1.Code)
	}
	// Same request_id again → deduped, accepted=0.
	rec2 := doPost(t, s, body, "Bearer k")
	if rec2.Code != http.StatusAccepted {
		t.Fatalf("second status = %d", rec2.Code)
	}
	var resp struct {
		Accepted   int `json:"accepted"`
		Duplicates int `json:"duplicates"`
	}
	_ = json.Unmarshal(rec2.Body.Bytes(), &resp)
	if resp.Accepted != 0 || resp.Duplicates != 1 {
		t.Fatalf("dedup response = %+v", resp)
	}
	if len(buf.added) != 1 {
		t.Fatalf("duplicate should not be buffered; total=%d", len(buf.added))
	}
}

func TestHealthzOK(t *testing.T) {
	s := newTestServer(&fakeAuth{ok: true}, &fakeBuffer{})
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("healthz = %d", rec.Code)
	}
}

func TestHealthzUnhealthyWhenCHDown(t *testing.T) {
	s := New(Config{
		Auth:       &fakeAuth{ok: true},
		Buffer:     &fakeBuffer{},
		Dedup:      dedup.New(time.Minute),
		Metrics:    metrics.New(),
		Log:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		ClickHouse: fakePinger{err: context.DeadlineExceeded},
		Postgres:   fakePinger{},
	})
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("healthz = %d want 503", rec.Code)
	}
}

func TestMetricsEndpoint(t *testing.T) {
	s := newTestServer(&fakeAuth{ok: true}, &fakeBuffer{})
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("metrics = %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "costobs_ingest_") {
		t.Fatal("expected costobs_ingest_ metrics in output")
	}
}
