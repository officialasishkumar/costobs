package auth

import (
	"context"
	"testing"
	"time"
)

func TestArgon2idRoundTrip(t *testing.T) {
	const raw = "costobs_dev_secret_key"
	hash, err := HashKey(raw)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	ok, err := VerifyKey(raw, hash)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !ok {
		t.Fatal("correct key should verify")
	}
	ok, err = VerifyKey("wrong", hash)
	if err != nil {
		t.Fatalf("verify wrong: %v", err)
	}
	if ok {
		t.Fatal("wrong key must not verify")
	}
}

func TestVerifyKeyRejectsMalformedHash(t *testing.T) {
	if _, err := VerifyKey("x", "not-a-hash"); err == nil {
		t.Fatal("expected error for malformed hash")
	}
}

func TestPrefix(t *testing.T) {
	cases := map[string]string{
		"costobs_dev_secret_key": "costobs_",
		"short":                  "short",
		"exactly8":               "exactly8",
		"":                       "",
	}
	for in, want := range cases {
		if got := Prefix(in); got != want {
			t.Errorf("Prefix(%q)=%q want %q", in, got, want)
		}
	}
}

// fakeStore implements Store, counting lookups so we can assert cache behavior.
type fakeStore struct {
	rec     KeyRecord
	prefix  string
	calls   int
	failAll bool
}

func (f *fakeStore) LookupByPrefix(_ context.Context, prefix string) (KeyRecord, error) {
	f.calls++
	if f.failAll || prefix != f.prefix {
		return KeyRecord{}, ErrUnauthorized
	}
	return f.rec, nil
}

func TestAuthenticateCacheHitMiss(t *testing.T) {
	const raw = "costobs_dev_secret_key"
	hash, err := HashKey(raw)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	store := &fakeStore{
		rec:    KeyRecord{OrgSlug: "default", KeyHash: hash},
		prefix: Prefix(raw),
	}
	a := NewAuthenticator(store, time.Minute)

	// First call → DB miss → lookup.
	slug, err := a.Authenticate(context.Background(), raw)
	if err != nil {
		t.Fatalf("authenticate: %v", err)
	}
	if slug != "default" {
		t.Fatalf("org slug = %q want default", slug)
	}
	if store.calls != 1 {
		t.Fatalf("expected 1 store call, got %d", store.calls)
	}

	// Second call → cache hit → no additional lookup.
	if _, err := a.Authenticate(context.Background(), raw); err != nil {
		t.Fatalf("authenticate cached: %v", err)
	}
	if store.calls != 1 {
		t.Fatalf("expected cache hit (still 1 store call), got %d", store.calls)
	}
}

func TestAuthenticateCacheExpiry(t *testing.T) {
	const raw = "costobs_dev_secret_key"
	hash, _ := HashKey(raw)
	store := &fakeStore{rec: KeyRecord{OrgSlug: "default", KeyHash: hash}, prefix: Prefix(raw)}

	now := time.Now()
	a := NewAuthenticator(store, time.Minute)
	a.now = func() time.Time { return now }

	if _, err := a.Authenticate(context.Background(), raw); err != nil {
		t.Fatalf("authenticate: %v", err)
	}
	now = now.Add(2 * time.Minute) // expire cache
	if _, err := a.Authenticate(context.Background(), raw); err != nil {
		t.Fatalf("authenticate after expiry: %v", err)
	}
	if store.calls != 2 {
		t.Fatalf("expected 2 store calls after cache expiry, got %d", store.calls)
	}
}

func TestAuthenticateRejectsUnknownAndEmpty(t *testing.T) {
	store := &fakeStore{prefix: "nomatch"}
	a := NewAuthenticator(store, time.Minute)

	if _, err := a.Authenticate(context.Background(), ""); err != ErrUnauthorized {
		t.Fatalf("empty key: got %v want ErrUnauthorized", err)
	}
	if _, err := a.Authenticate(context.Background(), "some_unknown_key"); err != ErrUnauthorized {
		t.Fatalf("unknown key: got %v want ErrUnauthorized", err)
	}
}

func TestAuthenticateRejectsWrongSecretSamePrefix(t *testing.T) {
	hash, _ := HashKey("the_real_secret_value")
	// Store returns a record for the prefix, but the raw secret differs.
	store := &fakeStore{rec: KeyRecord{OrgSlug: "default", KeyHash: hash}, prefix: Prefix("the_real_secret_value")}
	a := NewAuthenticator(store, time.Minute)

	// Same prefix "the_real", different full secret.
	if _, err := a.Authenticate(context.Background(), "the_realIMPOSTER"); err != ErrUnauthorized {
		t.Fatalf("wrong secret with matching prefix: got %v want ErrUnauthorized", err)
	}
}
