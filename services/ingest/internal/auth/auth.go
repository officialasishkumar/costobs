// Package auth handles per-org API key authentication: Postgres key lookup,
// argon2id verification, an in-memory verified-key cache with TTL, and the
// idempotent dev seed.
package auth

import (
	"context"
	"crypto/sha256"
	"errors"
	"sync"
	"time"
)

// ErrUnauthorized is returned when a key is missing, malformed, unknown, or
// revoked, or when the secret does not verify.
var ErrUnauthorized = errors.New("unauthorized")

// KeyRecord is an active api_keys row needed to verify a key.
type KeyRecord struct {
	OrgSlug string // orgs.slug — the ClickHouse org_id
	KeyHash string // PHC-encoded argon2id hash
}

// Store abstracts the Postgres-backed key/org lookups so the authenticator can
// be tested without a database.
type Store interface {
	// LookupByPrefix returns the active (non-revoked) api_key row whose
	// key_prefix matches, joined to its org slug. Returns ErrUnauthorized if
	// no active key matches.
	LookupByPrefix(ctx context.Context, prefix string) (KeyRecord, error)
}

type cacheEntry struct {
	orgSlug string
	expires time.Time
}

// Authenticator verifies bearer keys, caching successful verifications.
type Authenticator struct {
	store Store
	ttl   time.Duration
	now   func() time.Time

	mu    sync.RWMutex
	cache map[[32]byte]cacheEntry // keyed by SHA-256 of the raw key
}

// cacheKey hashes the raw bearer key so plaintext credentials never sit in the
// process heap (visible in heap dumps, cores, profiler snapshots).
func cacheKey(rawKey string) [32]byte {
	return sha256.Sum256([]byte(rawKey))
}

// NewAuthenticator builds an Authenticator with a verified-key cache TTL.
func NewAuthenticator(store Store, ttl time.Duration) *Authenticator {
	if ttl <= 0 {
		ttl = 60 * time.Second
	}
	return &Authenticator{
		store: store,
		ttl:   ttl,
		now:   time.Now,
		cache: make(map[[32]byte]cacheEntry),
	}
}

// Authenticate resolves a raw API key to its org slug (the org_id stamped onto
// events). Successful verifications are cached for the TTL. Returns
// ErrUnauthorized on any failure.
func (a *Authenticator) Authenticate(ctx context.Context, rawKey string) (string, error) {
	if rawKey == "" {
		return "", ErrUnauthorized
	}

	now := a.now()
	ck := cacheKey(rawKey)
	a.mu.RLock()
	ent, ok := a.cache[ck]
	a.mu.RUnlock()
	if ok && now.Before(ent.expires) {
		return ent.orgSlug, nil
	}

	rec, err := a.store.LookupByPrefix(ctx, Prefix(rawKey))
	if err != nil {
		return "", ErrUnauthorized
	}

	valid, err := VerifyKey(rawKey, rec.KeyHash)
	if err != nil || !valid {
		return "", ErrUnauthorized
	}

	a.mu.Lock()
	a.cache[ck] = cacheEntry{orgSlug: rec.OrgSlug, expires: now.Add(a.ttl)}
	a.mu.Unlock()

	return rec.OrgSlug, nil
}

// PurgeExpired drops expired cache entries. Optional housekeeping.
func (a *Authenticator) PurgeExpired() {
	now := a.now()
	a.mu.Lock()
	defer a.mu.Unlock()
	for k, e := range a.cache {
		if now.After(e.expires) {
			delete(a.cache, k)
		}
	}
}
