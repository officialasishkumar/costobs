package rules

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PGStore is the Postgres-backed Store.
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
func (s *PGStore) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// Close releases the pool.
func (s *PGStore) Close() { s.pool.Close() }

// LoadEnabledRules returns all enabled rules joined to their org slug with
// targets attached. It issues two queries (rules, then all targets for those
// rules) and stitches them together in memory.
func (s *PGStore) LoadEnabledRules(ctx context.Context) ([]Rule, error) {
	const ruleQ = `
		SELECT r.id, r.org_id, o.slug, r.name, r.kind,
		       r.scope::text, r.config::text, r.cooldown_seconds, r.last_fired_at
		FROM alert_rules r
		JOIN orgs o ON o.id = r.org_id
		WHERE r.enabled = true
		ORDER BY r.id`

	rows, err := s.pool.Query(ctx, ruleQ)
	if err != nil {
		return nil, fmt.Errorf("query alert_rules: %w", err)
	}
	defer rows.Close()

	var (
		out  []Rule
		byID = map[int64]int{} // rule id -> index in out
	)
	for rows.Next() {
		var (
			r          Rule
			scopeJSON  string
			configJSON string
			lastFired  *time.Time
		)
		if err := rows.Scan(&r.ID, &r.OrgID, &r.OrgSlug, &r.Name, &r.Kind,
			&scopeJSON, &configJSON, &r.CooldownSeconds, &lastFired); err != nil {
			return nil, fmt.Errorf("scan alert_rule: %w", err)
		}
		if err := json.Unmarshal([]byte(scopeJSON), &r.Scope); err != nil {
			return nil, fmt.Errorf("rule %d: parse scope: %w", r.ID, err)
		}
		if err := json.Unmarshal([]byte(configJSON), &r.Config); err != nil {
			return nil, fmt.Errorf("rule %d: parse config: %w", r.ID, err)
		}
		r.LastFiredAt = lastFired
		byID[r.ID] = len(out)
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate alert_rules: %w", err)
	}
	if len(out) == 0 {
		return out, nil
	}

	const targetQ = `
		SELECT t.id, t.rule_id, t.kind, t.config::text
		FROM alert_targets t
		JOIN alert_rules r ON r.id = t.rule_id
		WHERE r.enabled = true`

	trows, err := s.pool.Query(ctx, targetQ)
	if err != nil {
		return nil, fmt.Errorf("query alert_targets: %w", err)
	}
	defer trows.Close()

	for trows.Next() {
		var (
			t          Target
			ruleID     int64
			configJSON string
		)
		if err := trows.Scan(&t.ID, &ruleID, &t.Kind, &configJSON); err != nil {
			return nil, fmt.Errorf("scan alert_target: %w", err)
		}
		if err := json.Unmarshal([]byte(configJSON), &t.Config); err != nil {
			return nil, fmt.Errorf("target %d: parse config: %w", t.ID, err)
		}
		if idx, ok := byID[ruleID]; ok {
			out[idx].Targets = append(out[idx].Targets, t)
		}
	}
	if err := trows.Err(); err != nil {
		return nil, fmt.Errorf("iterate alert_targets: %w", err)
	}

	return out, nil
}

// MarkFired sets alert_rules.last_fired_at for the rule.
func (s *PGStore) MarkFired(ctx context.Context, ruleID int64, firedAt time.Time) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE alert_rules SET last_fired_at = $1 WHERE id = $2`, firedAt.UTC(), ruleID)
	if err != nil {
		return fmt.Errorf("update last_fired_at: %w", err)
	}
	return nil
}
