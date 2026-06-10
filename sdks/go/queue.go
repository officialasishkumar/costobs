package costobs

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// queue batches events and ships them asynchronously to the ingest service.
// The hot path is a non-blocking channel send: when the buffer is full the
// event is dropped (never block the caller), mirroring the Python/TS SDKs.
type queue struct {
	events   chan Event
	url      string
	apiKey   string
	client   *http.Client
	batch    int
	interval time.Duration
	retries  int
	log      *slog.Logger

	wg       sync.WaitGroup
	stopOnce sync.Once
	stop     chan struct{}

	mu       sync.Mutex
	inFlight int
	dropped  int
}

func newQueue(ingestURL, apiKey string, batch int, interval time.Duration, log *slog.Logger) *queue {
	if batch <= 0 {
		batch = 100
	}
	if interval <= 0 {
		interval = time.Second
	}
	q := &queue{
		events:   make(chan Event, 10_000),
		url:      ingestURL + "/v1/events",
		apiKey:   apiKey,
		client:   &http.Client{Timeout: 5 * time.Second},
		batch:    batch,
		interval: interval,
		retries:  3,
		log:      log,
		stop:     make(chan struct{}),
	}
	q.wg.Add(1)
	go q.run()
	return q
}

// enqueue never blocks; drops with a warning when the buffer is full.
func (q *queue) enqueue(e Event) {
	select {
	case q.events <- e:
	default:
		q.mu.Lock()
		q.dropped++
		n := q.dropped
		q.mu.Unlock()
		q.log.Warn("costobs: telemetry buffer full, dropping event", "total_dropped", n)
	}
}

func (q *queue) run() {
	defer q.wg.Done()
	var batch []Event
	timer := time.NewTimer(q.interval)
	defer timer.Stop()

	flush := func() {
		if len(batch) == 0 {
			return
		}
		q.mu.Lock()
		q.inFlight = len(batch)
		q.mu.Unlock()
		q.ship(batch)
		q.mu.Lock()
		q.inFlight = 0
		q.mu.Unlock()
		batch = nil
	}

	for {
		select {
		case <-q.stop:
			// Drain whatever is buffered, then exit.
			for {
				select {
				case e := <-q.events:
					batch = append(batch, e)
					if len(batch) >= q.batch {
						flush()
					}
				default:
					flush()
					return
				}
			}
		case e := <-q.events:
			batch = append(batch, e)
			if len(batch) >= q.batch {
				flush()
				timer.Reset(q.interval)
			}
		case <-timer.C:
			flush()
			timer.Reset(q.interval)
		}
	}
}

func (q *queue) ship(events []Event) {
	body, err := json.Marshal(map[string][]Event{"events": events})
	if err != nil {
		q.log.Error("costobs: marshal events", "error", err)
		return
	}
	backoff := 100 * time.Millisecond
	for attempt := 0; attempt < q.retries; attempt++ {
		req, err := http.NewRequest(http.MethodPost, q.url, bytes.NewReader(body))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+q.apiKey)
		resp, err := q.client.Do(req)
		if err == nil {
			_ = resp.Body.Close()
			switch {
			case resp.StatusCode == http.StatusAccepted:
				return
			case resp.StatusCode == http.StatusUnauthorized:
				q.log.Warn("costobs: ingest auth failed (401), dropping batch", "events", len(events))
				return
			case resp.StatusCode == http.StatusTooManyRequests:
				// backpressure: retry same batch
			default:
				q.log.Warn("costobs: ingest rejected batch", "status", resp.StatusCode, "events", len(events))
				return
			}
		}
		time.Sleep(backoff)
		backoff *= 2
		if backoff > 2*time.Second {
			backoff = 2 * time.Second
		}
	}
	q.mu.Lock()
	q.dropped += len(events)
	q.mu.Unlock()
	q.log.Warn("costobs: dropping batch after retries", "events", len(events))
}

// flushWait blocks until the buffer and in-flight batch are empty or timeout.
func (q *queue) flushWait(ctx context.Context) bool {
	for {
		q.mu.Lock()
		inFlight := q.inFlight
		q.mu.Unlock()
		if len(q.events) == 0 && inFlight == 0 {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(10 * time.Millisecond):
		}
	}
}

// close drains and stops the sender. Idempotent.
func (q *queue) close() {
	q.stopOnce.Do(func() { close(q.stop) })
	q.wg.Wait()
}
