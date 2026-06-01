package dedup

import (
	"testing"
	"time"
)

func TestSeenDeduplicatesWithinWindow(t *testing.T) {
	s := New(5 * time.Minute)

	if s.Seen("req-1") {
		t.Fatal("first sighting should not be a duplicate")
	}
	if !s.Seen("req-1") {
		t.Fatal("second sighting within window should be a duplicate")
	}
	if s.Seen("req-2") {
		t.Fatal("distinct key should not be a duplicate")
	}
}

func TestEmptyKeyNeverDeduped(t *testing.T) {
	s := New(time.Minute)
	if s.Seen("") {
		t.Fatal("empty key must not dedup")
	}
	if s.Seen("") {
		t.Fatal("empty key must never report seen")
	}
}

func TestEvictionAfterTTL(t *testing.T) {
	now := time.Now()
	s := New(time.Minute)
	s.now = func() time.Time { return now }

	if s.Seen("req-1") {
		t.Fatal("first sighting should not be a duplicate")
	}
	if s.Len() != 1 {
		t.Fatalf("expected 1 tracked entry, got %d", s.Len())
	}

	// Advance past TTL and evict.
	now = now.Add(2 * time.Minute)
	s.evict()
	if s.Len() != 0 {
		t.Fatalf("expected entries evicted, got %d", s.Len())
	}

	// After eviction the same key is treated as new.
	if s.Seen("req-1") {
		t.Fatal("evicted key should be treated as new")
	}
}

func TestSeenExpiresWithoutEvict(t *testing.T) {
	now := time.Now()
	s := New(time.Minute)
	s.now = func() time.Time { return now }

	s.Seen("k")
	now = now.Add(2 * time.Minute)
	if s.Seen("k") {
		t.Fatal("entry past TTL should not count as duplicate even before sweep")
	}
}
