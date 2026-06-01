package batch

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/officialasishkumar/costobs/services/ingest/internal/metrics"
	"github.com/officialasishkumar/costobs/services/ingest/internal/model"
)

// fakeWriter records inserted batches; optionally fails.
type fakeWriter struct {
	mu       sync.Mutex
	batches  [][]model.Event
	total    int
	failNext int // number of upcoming Insert calls that should fail
}

func (f *fakeWriter) Insert(_ context.Context, events []model.Event) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failNext > 0 {
		f.failNext--
		return errors.New("simulated clickhouse failure")
	}
	cp := make([]model.Event, len(events))
	copy(cp, events)
	f.batches = append(f.batches, cp)
	f.total += len(events)
	return nil
}

func (f *fakeWriter) Ping(context.Context) error { return nil }
func (f *fakeWriter) Close() error               { return nil }

func (f *fakeWriter) totalInserted() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.total
}

func (f *fakeWriter) batchCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.batches)
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func mkEvents(n int) []model.Event {
	out := make([]model.Event, n)
	for i := range out {
		out[i] = model.Event{RequestID: "r", OrgID: "org"}
	}
	return out
}

func waitFor(t *testing.T, d time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("condition not met within %s", d)
}

func TestFlushByN(t *testing.T) {
	fw := &fakeWriter{}
	m := metrics.New()
	b := New(fw, m, testLogger(), Options{
		MaxEvents:   5,
		MaxInterval: time.Hour, // ensure time-based flush doesn't fire
		Capacity:    100,
	})
	go b.Run()

	accepted, full := b.Add(mkEvents(5))
	if full || accepted != 5 {
		t.Fatalf("add: accepted=%d full=%v", accepted, full)
	}

	waitFor(t, time.Second, func() bool { return fw.totalInserted() == 5 })
	if fw.batchCount() != 1 {
		t.Fatalf("expected 1 flush, got %d", fw.batchCount())
	}

	b.Shutdown(context.Background())
}

func TestFlushByT(t *testing.T) {
	fw := &fakeWriter{}
	m := metrics.New()
	b := New(fw, m, testLogger(), Options{
		MaxEvents:   1000, // never reached
		MaxInterval: 30 * time.Millisecond,
		Capacity:    2000,
	})
	go b.Run()

	if _, full := b.Add(mkEvents(3)); full {
		t.Fatal("unexpected backpressure")
	}

	waitFor(t, time.Second, func() bool { return fw.totalInserted() == 3 })
	b.Shutdown(context.Background())
}

func TestBackpressureWhenFull(t *testing.T) {
	fw := &fakeWriter{}
	m := metrics.New()
	// Stop the flush loop from draining so the buffer fills and stays full.
	b := New(fw, m, testLogger(), Options{
		MaxEvents:   10,
		MaxInterval: time.Hour,
		Capacity:    10,
	})
	// Intentionally do NOT start Run() so nothing drains.

	if _, full := b.Add(mkEvents(10)); full {
		t.Fatal("first add up to capacity should succeed")
	}
	// One more event exceeds capacity → backpressure.
	accepted, full := b.Add(mkEvents(1))
	if !full || accepted != 0 {
		t.Fatalf("expected backpressure: accepted=%d full=%v", accepted, full)
	}
	if b.Depth() != 10 {
		t.Fatalf("depth should remain at capacity, got %d", b.Depth())
	}
}

func TestRetryThenSucceed(t *testing.T) {
	fw := &fakeWriter{failNext: 2} // first two inserts fail, third succeeds
	m := metrics.New()
	b := New(fw, m, testLogger(), Options{
		MaxEvents:     3,
		MaxInterval:   time.Hour,
		Capacity:      100,
		RetryAttempts: 5,
		RetryBackoff:  time.Millisecond,
	})
	go b.Run()

	b.Add(mkEvents(3))
	waitFor(t, time.Second, func() bool { return fw.totalInserted() == 3 })
	b.Shutdown(context.Background())
}

func TestShutdownDrains(t *testing.T) {
	fw := &fakeWriter{}
	m := metrics.New()
	b := New(fw, m, testLogger(), Options{
		MaxEvents:   1000,
		MaxInterval: time.Hour,
		Capacity:    2000,
	})
	go b.Run()

	b.Add(mkEvents(7))
	b.Shutdown(context.Background())

	if fw.totalInserted() != 7 {
		t.Fatalf("shutdown should drain buffer; inserted=%d", fw.totalInserted())
	}
}
