// Package dedup provides a best-effort, in-memory, TTL-based dedup set keyed by
// request_id. It is sharded to reduce lock contention and is not cross-instance.
package dedup

import (
	"hash/fnv"
	"sync"
	"time"
)

const shardCount = 32

type shard struct {
	mu   sync.Mutex
	seen map[string]time.Time
}

// Set is a sharded TTL dedup set.
type Set struct {
	ttl    time.Duration
	shards [shardCount]*shard
	now    func() time.Time // injectable clock for tests
}

// New creates a dedup Set whose entries expire after ttl.
func New(ttl time.Duration) *Set {
	s := &Set{ttl: ttl, now: time.Now}
	for i := range s.shards {
		s.shards[i] = &shard{seen: make(map[string]time.Time)}
	}
	return s
}

func (s *Set) shardFor(key string) *shard {
	h := fnv.New32a()
	_, _ = h.Write([]byte(key))
	return s.shards[h.Sum32()%shardCount]
}

// Seen reports whether key was already observed within the TTL window. If not
// seen (or its prior entry has expired), it records key as seen now and returns
// false. Empty keys are never deduped (always returns false).
func (s *Set) Seen(key string) bool {
	if key == "" {
		return false
	}
	now := s.now()
	sh := s.shardFor(key)
	sh.mu.Lock()
	defer sh.mu.Unlock()

	if exp, ok := sh.seen[key]; ok && now.Sub(exp) < s.ttl {
		return true
	}
	sh.seen[key] = now
	return false
}

// evict removes entries older than the TTL across all shards.
func (s *Set) evict() {
	now := s.now()
	for _, sh := range s.shards {
		sh.mu.Lock()
		for k, t := range sh.seen {
			if now.Sub(t) >= s.ttl {
				delete(sh.seen, k)
			}
		}
		sh.mu.Unlock()
	}
}

// Run starts a background eviction loop that sweeps expired entries every
// interval until ctx-equivalent stop channel is closed.
func (s *Set) Run(stop <-chan struct{}, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			s.evict()
		}
	}
}

// Len returns the total number of tracked entries (for tests/metrics).
func (s *Set) Len() int {
	n := 0
	for _, sh := range s.shards {
		sh.mu.Lock()
		n += len(sh.seen)
		sh.mu.Unlock()
	}
	return n
}
