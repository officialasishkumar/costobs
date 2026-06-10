package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PGStore is the Postgres-backed Store and seeder.
type PGStore struct {
	pool *pgxpool.Pool
}

// NewPGStore opens a pgx pool against dsn and verifies connectivity.
func NewPGStore(ctx context.Context, dsn string) (*PGStore, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("open postgres pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return &PGStore{pool: pool}, nil
}

// Ping checks Postgres reachability.
func (s *PGStore) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

// Close releases the pool.
func (s *PGStore) Close() {
	s.pool.Close()
}

// LookupByPrefix returns the active key row + org slug for the given prefix.
func (s *PGStore) LookupByPrefix(ctx context.Context, prefix string) (KeyRecord, error) {
	const q = `
		SELECT o.slug, k.key_hash
		FROM api_keys k
		JOIN orgs o ON o.id = k.org_id
		WHERE k.key_prefix = $1 AND k.revoked_at IS NULL
		LIMIT 1`
	var slug string
	var hash []byte
	err := s.pool.QueryRow(ctx, q, prefix).Scan(&slug, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return KeyRecord{}, ErrUnauthorized
	}
	if err != nil {
		return KeyRecord{}, fmt.Errorf("lookup key by prefix: %w", err)
	}
	return KeyRecord{OrgSlug: slug, KeyHash: string(hash)}, nil
}

// Seed idempotently ensures an org with the given slug exists and an active
// api_key whose raw value is rawKey exists. Safe to call repeatedly. It logs
// the org slug and key prefix (never the full key).
func (s *PGStore) Seed(ctx context.Context, orgSlug, rawKey string, log *slog.Logger) error {
	if orgSlug == "" {
		return fmt.Errorf("seed: org slug is empty")
	}
	if rawKey == "" {
		return fmt.Errorf("seed: dev api key is empty")
	}

	// Ensure org exists, capture its id.
	var orgID int64
	err := s.pool.QueryRow(ctx, `
		INSERT INTO orgs (slug, name)
		VALUES ($1, $2)
		ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
		RETURNING id`, orgSlug, orgSlug).Scan(&orgID)
	if err != nil {
		return fmt.Errorf("seed org: %w", err)
	}

	prefix := Prefix(rawKey)

	// Is there already an active key with this prefix for this org?
	var existing int64
	err = s.pool.QueryRow(ctx, `
		SELECT id FROM api_keys
		WHERE org_id = $1 AND key_prefix = $2 AND revoked_at IS NULL
		LIMIT 1`, orgID, prefix).Scan(&existing)
	switch {
	case err == nil:
		log.Info("dev seed: api key already present",
			"org_slug", orgSlug, "key_prefix", prefix)
		return nil
	case errors.Is(err, pgx.ErrNoRows):
		// fall through to create
	default:
		return fmt.Errorf("seed: check existing key: %w", err)
	}

	hash, err := HashKey(rawKey)
	if err != nil {
		return fmt.Errorf("seed: hash key: %w", err)
	}
	// ON CONFLICT targets the api_keys_active_prefix partial unique index so
	// two instances seeding concurrently (rolling deploys) can't race the
	// SELECT above into a duplicate-key startup failure.
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO api_keys (org_id, name, key_prefix, key_hash)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (key_prefix) WHERE revoked_at IS NULL DO NOTHING`,
		orgID, "dev-seed", prefix, []byte(hash)); err != nil {
		return fmt.Errorf("seed: insert api key: %w", err)
	}

	log.Info("dev seed: created org + api key",
		"org_slug", orgSlug, "key_prefix", prefix)
	return nil
}
