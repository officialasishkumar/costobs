// Package rules loads enabled alert rules and their delivery targets from
// Postgres, applies cooldown logic, and persists last_fired_at after a fire.
//
// The store is defined behind an interface so the loop and cooldown logic are
// unit-testable with a fake store and a fake clock.
package rules

import (
	"context"
	"time"
)

// Target is a single delivery destination for a rule.
type Target struct {
	ID     int64
	Kind   string         // "webhook" | "slack"
	Config map[string]any // arbitrary target config (url, secret, ...)
}

// Rule is a fully-loaded alert rule with its org slug, parsed scope/config, and
// delivery targets.
type Rule struct {
	ID              int64
	OrgID           int64
	OrgSlug         string
	Name            string
	Kind            string
	Scope           map[string]string
	Config          map[string]any
	CooldownSeconds int
	LastFiredAt     *time.Time
	Targets         []Target
}

// InCooldown reports whether the rule is still within its cooldown window at
// time now and must therefore be skipped. A rule that has never fired is never
// in cooldown.
func (r *Rule) InCooldown(now time.Time) bool {
	if r.LastFiredAt == nil {
		return false
	}
	cd := time.Duration(r.CooldownSeconds) * time.Second
	return now.UTC().Sub(r.LastFiredAt.UTC()) < cd
}

// Store loads rules and records fires. Implemented by PGStore in production and
// by fakes in tests.
type Store interface {
	// LoadEnabledRules returns all enabled rules joined to their org slug, each
	// with its targets attached.
	LoadEnabledRules(ctx context.Context) ([]Rule, error)
	// MarkFired sets alert_rules.last_fired_at = firedAt for the rule.
	MarkFired(ctx context.Context, ruleID int64, firedAt time.Time) error
	// Ping checks store reachability.
	Ping(ctx context.Context) error
	// Close releases resources.
	Close()
}
