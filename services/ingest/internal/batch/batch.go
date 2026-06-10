// Package batch implements a bounded in-memory buffer with a flush loop that
// drains to a chwriter.Writer when the buffer reaches MaxEvents or MaxInterval
// elapses. When the buffer is full it signals backpressure so the HTTP layer
// can return 429 rather than OOM.
package batch

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/officialasishkumar/costobs/services/ingest/internal/chwriter"
	"github.com/officialasishkumar/costobs/services/ingest/internal/metrics"
	"github.com/officialasishkumar/costobs/services/ingest/internal/model"
)

// Options configures a Buffer.
type Options struct {
	MaxEvents     int           // flush trigger; also the hard buffer capacity ceiling
	MaxInterval   time.Duration // time-based flush trigger
	Capacity      int           // hard cap on buffered events (defaults to 2*MaxEvents)
	RetryAttempts int           // insert retry attempts (default 5)
	RetryBackoff  time.Duration // initial backoff (default 100ms)
	FlushTimeout  time.Duration // hard deadline per flush incl. retries (default 30s)
}

// Buffer is the bounded event buffer + flush loop.
type Buffer struct {
	opts    Options
	writer  chwriter.Writer
	metrics *metrics.Metrics
	log     *slog.Logger

	mu  sync.Mutex
	buf []model.Event

	flushReq chan struct{} // signals "buffer reached MaxEvents, flush now"
	stop      chan struct{}
	done      chan struct{}
	closeOnce sync.Once
}

// New constructs a Buffer.
func New(w chwriter.Writer, m *metrics.Metrics, log *slog.Logger, opts Options) *Buffer {
	if opts.MaxEvents <= 0 {
		opts.MaxEvents = 1000
	}
	if opts.MaxInterval <= 0 {
		opts.MaxInterval = 2 * time.Second
	}
	if opts.Capacity <= 0 {
		opts.Capacity = opts.MaxEvents * 2
	}
	if opts.Capacity < opts.MaxEvents {
		opts.Capacity = opts.MaxEvents
	}
	if opts.RetryAttempts <= 0 {
		opts.RetryAttempts = 5
	}
	if opts.RetryBackoff <= 0 {
		opts.RetryBackoff = 100 * time.Millisecond
	}
	if opts.FlushTimeout <= 0 {
		opts.FlushTimeout = 30 * time.Second
	}
	return &Buffer{
		opts:     opts,
		writer:   w,
		metrics:  m,
		log:      log,
		buf:      make([]model.Event, 0, opts.MaxEvents),
		flushReq: make(chan struct{}, 1),
		stop:     make(chan struct{}),
		done:     make(chan struct{}),
	}
}

// Add attempts to enqueue events. It returns the number accepted; if fewer than
// len(events) are accepted, the buffer is full (backpressure) and the caller
// should return 429. It is all-or-nothing per batch to keep request semantics
// simple: either the whole batch fits or none of it is enqueued.
func (b *Buffer) Add(events []model.Event) (accepted int, full bool) {
	if len(events) == 0 {
		return 0, false
	}
	b.mu.Lock()
	if len(b.buf)+len(events) > b.opts.Capacity {
		depth := len(b.buf)
		b.mu.Unlock()
		b.metrics.BufferDepth.Set(float64(depth))
		return 0, true
	}
	b.buf = append(b.buf, events...)
	depth := len(b.buf)
	reachedMax := depth >= b.opts.MaxEvents
	b.mu.Unlock()

	b.metrics.BufferDepth.Set(float64(depth))
	if reachedMax {
		b.signalFlush()
	}
	return len(events), false
}

func (b *Buffer) signalFlush() {
	select {
	case b.flushReq <- struct{}{}:
	default:
	}
}

// swap atomically takes the current buffer contents, returning them and
// resetting the live buffer.
func (b *Buffer) swap() []model.Event {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.buf) == 0 {
		return nil
	}
	out := b.buf
	b.buf = make([]model.Event, 0, b.opts.MaxEvents)
	b.metrics.BufferDepth.Set(0)
	return out
}

// Run drives the flush loop until Shutdown is called. It flushes on MaxInterval
// ticks and whenever a MaxEvents threshold is signalled.
func (b *Buffer) Run() {
	defer close(b.done)
	ticker := time.NewTicker(b.opts.MaxInterval)
	defer ticker.Stop()

	for {
		select {
		case <-b.stop:
			return
		case <-ticker.C:
			b.flushWithTimeout()
		case <-b.flushReq:
			b.flushWithTimeout()
		}
	}
}

// flushWithTimeout bounds a single flush (including retries) so a hung
// ClickHouse connection can't stall the loop indefinitely and back the HTTP
// layer up into permanent 429s.
func (b *Buffer) flushWithTimeout() {
	ctx, cancel := context.WithTimeout(context.Background(), b.opts.FlushTimeout)
	defer cancel()
	b.flush(ctx)
}

// flush drains the current buffer and writes it with bounded retry.
func (b *Buffer) flush(ctx context.Context) {
	events := b.swap()
	if len(events) == 0 {
		return
	}
	b.metrics.BatchSize.Observe(float64(len(events)))

	start := time.Now()
	err := chwriter.RetryInsert(ctx, b.writer, events, b.opts.RetryAttempts, b.opts.RetryBackoff)
	b.metrics.InsertDuration.Observe(time.Since(start).Seconds())

	if err != nil {
		// Could not persist after retries. Drop to protect memory; record it.
		b.metrics.EventsDropped.Add(float64(len(events)))
		b.log.Error("flush failed; dropping batch",
			"events", len(events), "error", err)
		return
	}
	b.metrics.BatchesFlushed.Inc()
	b.metrics.EventsInserted.Add(float64(len(events)))
	b.log.Debug("flushed batch", "events", len(events), "duration", time.Since(start))
}

// Depth returns the current buffer depth.
func (b *Buffer) Depth() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.buf)
}

// Shutdown stops the flush loop and drains any remaining buffered events using
// the provided context as a deadline for the final flush.
func (b *Buffer) Shutdown(ctx context.Context) {
	b.closeOnce.Do(func() {
		close(b.stop)
	})
	<-b.done
	// Final drain — may span multiple batches if buffer exceeds MaxEvents.
	for b.Depth() > 0 {
		before := b.Depth()
		b.flush(ctx)
		if b.Depth() >= before {
			// No progress (e.g. ctx expired or persistent error); stop.
			break
		}
	}
}
