package main

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/officialasishkumar/costobs/services/alertd/internal/deliver"
	"github.com/officialasishkumar/costobs/services/alertd/internal/metrics"
	"github.com/officialasishkumar/costobs/services/alertd/internal/rules"
)

// fakeStore implements rules.Store with in-memory rules and records MarkFired.
type fakeStore struct {
	rules    []rules.Rule
	firedIDs []int64
}

func (s *fakeStore) LoadEnabledRules(context.Context) ([]rules.Rule, error) { return s.rules, nil }
func (s *fakeStore) MarkFired(_ context.Context, id int64, _ time.Time) error {
	s.firedIDs = append(s.firedIDs, id)
	return nil
}
func (s *fakeStore) Ping(context.Context) error { return nil }
func (s *fakeStore) Close()                     {}

// fakeRunner returns a fixed sum for every query.
type fakeRunner struct{ sum float64 }

func (f fakeRunner) SumCost(context.Context, string, ...any) (float64, error) { return f.sum, nil }

func newTestWorker(store rules.Store, sum float64, now time.Time) *worker {
	return &worker{
		store:      store,
		ch:         fakeRunner{sum: sum},
		dispatcher: deliver.New(nil),
		metrics:    metrics.New(),
		log:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		now:        func() time.Time { return now },
	}
}

func TestWorker_FiresWhenBreachedAndMarksFired(t *testing.T) {
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	store := &fakeStore{rules: []rules.Rule{{
		ID:              1,
		OrgSlug:         "acme",
		Name:            "daily cap",
		Kind:            "daily_threshold",
		Scope:           map[string]string{},
		Config:          map[string]any{"threshold_usd": float64(100)},
		CooldownSeconds: 3600,
		// no targets: still should mark fired without error
	}}}

	w := newTestWorker(store, 150, now) // observed 150 > 100
	w.evaluateOnce(context.Background())

	if len(store.firedIDs) != 1 || store.firedIDs[0] != 1 {
		t.Fatalf("expected rule 1 marked fired, got %v", store.firedIDs)
	}
}

func TestWorker_SkipsWhenInCooldown(t *testing.T) {
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	last := now.Add(-5 * time.Minute)
	store := &fakeStore{rules: []rules.Rule{{
		ID:              2,
		OrgSlug:         "acme",
		Name:            "daily cap",
		Kind:            "daily_threshold",
		Config:          map[string]any{"threshold_usd": float64(100)},
		CooldownSeconds: 3600,
		LastFiredAt:     &last,
	}}}

	w := newTestWorker(store, 150, now) // would breach, but in cooldown
	w.evaluateOnce(context.Background())

	if len(store.firedIDs) != 0 {
		t.Fatalf("expected no fire while in cooldown, got %v", store.firedIDs)
	}
}

func TestWorker_DoesNotFireWhenNotBreached(t *testing.T) {
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	store := &fakeStore{rules: []rules.Rule{{
		ID:              3,
		OrgSlug:         "acme",
		Kind:            "monthly_budget",
		Config:          map[string]any{"budget_usd": float64(1000)},
		CooldownSeconds: 3600,
	}}}

	w := newTestWorker(store, 50, now) // observed 50 < 1000
	w.evaluateOnce(context.Background())

	if len(store.firedIDs) != 0 {
		t.Fatalf("expected no fire, got %v", store.firedIDs)
	}
}

func TestToEvalRule_ValidatesConfig(t *testing.T) {
	if _, err := toEvalRule(&rules.Rule{Kind: "daily_threshold", Config: map[string]any{}}); err == nil {
		t.Error("expected error for missing threshold_usd")
	}
	if _, err := toEvalRule(&rules.Rule{Kind: "spike", Config: map[string]any{"factor": "nope"}}); err == nil {
		t.Error("expected error for non-numeric factor")
	}
	r, err := toEvalRule(&rules.Rule{Kind: "spike", Config: map[string]any{"factor": float64(2)}})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if r.Baseline != "rolling_7d" {
		t.Errorf("default baseline = %q, want rolling_7d", r.Baseline)
	}
}
