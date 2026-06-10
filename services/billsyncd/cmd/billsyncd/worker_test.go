package main

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/shopspring/decimal"

	"github.com/officialasishkumar/costobs/services/billsyncd/internal/metrics"
	"github.com/officialasishkumar/costobs/services/billsyncd/internal/providers"
	"github.com/officialasishkumar/costobs/services/billsyncd/internal/store"
)

type fakeFetcher struct {
	name  string
	daily []providers.DailyCost
	err   error
}

func (f *fakeFetcher) Name() string { return f.name }
func (f *fakeFetcher) FetchDaily(ctx context.Context, from, to time.Time) ([]providers.DailyCost, error) {
	return f.daily, f.err
}

type fakeStore struct {
	rows []store.Row
	err  error
}

func (s *fakeStore) Upsert(ctx context.Context, rows []store.Row) error {
	if s.err != nil {
		return s.err
	}
	s.rows = append(s.rows, rows...)
	return nil
}
func (s *fakeStore) Ping(ctx context.Context) error { return nil }
func (s *fakeStore) Close() error                   { return nil }

func newTestWorker(st store.Store, fetchers ...providers.Fetcher) *worker {
	return &worker{
		store:        st,
		fetchers:     fetchers,
		orgSlug:      "default",
		lookbackDays: 7,
		metrics:      metrics.New(),
		log:          slog.New(slog.DiscardHandler),
		now:          func() time.Time { return time.Date(2026, 6, 10, 12, 0, 0, 0, time.UTC) },
	}
}

func TestSyncOnceUpsertsRowsPerProvider(t *testing.T) {
	day := time.Date(2026, 6, 9, 0, 0, 0, 0, time.UTC)
	st := &fakeStore{}
	w := newTestWorker(st,
		&fakeFetcher{name: "openai", daily: []providers.DailyCost{{Date: day, USD: decimal.NewFromFloat(12.5)}}},
		&fakeFetcher{name: "anthropic", daily: []providers.DailyCost{{Date: day, USD: decimal.NewFromFloat(3.25)}}},
	)

	w.syncOnce(context.Background())

	if len(st.rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(st.rows))
	}
	if st.rows[0].Provider != "openai" || st.rows[0].OrgID != "default" {
		t.Errorf("row0 wrong: %+v", st.rows[0])
	}
	if st.rows[0].Source != "api" {
		t.Errorf("source should default to api, got %q", st.rows[0].Source)
	}
	if st.rows[1].Provider != "anthropic" || st.rows[1].BilledUSD.String() != "3.25" {
		t.Errorf("row1 wrong: %+v", st.rows[1])
	}
}

func TestSyncOnceOneFailingProviderDoesNotBlockOthers(t *testing.T) {
	day := time.Date(2026, 6, 9, 0, 0, 0, 0, time.UTC)
	st := &fakeStore{}
	w := newTestWorker(st,
		&fakeFetcher{name: "openai", err: errors.New("403 insufficient permissions")},
		&fakeFetcher{name: "anthropic", daily: []providers.DailyCost{{Date: day, USD: decimal.NewFromInt(1)}}},
	)

	w.syncOnce(context.Background())

	if len(st.rows) != 1 || st.rows[0].Provider != "anthropic" {
		t.Fatalf("anthropic should still sync after openai failure, rows: %+v", st.rows)
	}
}

func TestSyncOnceNoFetchersIsNoop(t *testing.T) {
	st := &fakeStore{}
	w := newTestWorker(st)
	w.syncOnce(context.Background())
	if len(st.rows) != 0 {
		t.Fatalf("expected no rows, got %d", len(st.rows))
	}
}
