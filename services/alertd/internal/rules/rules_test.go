package rules

import (
	"testing"
	"time"
)

func ptr(t time.Time) *time.Time { return &t }

func TestInCooldown(t *testing.T) {
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name      string
		lastFired *time.Time
		cooldown  int
		want      bool
	}{
		{"never fired", nil, 3600, false},
		{"just fired, within cooldown", ptr(now.Add(-10 * time.Minute)), 3600, true},
		{"fired long ago, past cooldown", ptr(now.Add(-2 * time.Hour)), 3600, false},
		{"exactly at boundary not in cooldown", ptr(now.Add(-1 * time.Hour)), 3600, false},
		{"zero cooldown never blocks", ptr(now.Add(-1 * time.Second)), 0, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := Rule{LastFiredAt: tt.lastFired, CooldownSeconds: tt.cooldown}
			if got := r.InCooldown(now); got != tt.want {
				t.Errorf("InCooldown = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestInCooldown_HandlesNonUTCInput(t *testing.T) {
	loc := time.FixedZone("X", 5*3600)
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC).In(loc)
	// fired 30 min ago in UTC, cooldown 1h -> still in cooldown regardless of tz.
	r := Rule{LastFiredAt: ptr(time.Date(2026, 6, 1, 11, 30, 0, 0, time.UTC)), CooldownSeconds: 3600}
	if !r.InCooldown(now) {
		t.Error("expected in cooldown across timezones")
	}
}
