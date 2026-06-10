// Package config parses the billsyncd service configuration from environment
// variables.
//
// billsyncd is the ONLY CostObs component that talks to external services, and
// only when explicitly opted in by setting provider admin keys. With no keys
// configured it idles (healthy, no outbound traffic) — the offline-by-design
// guarantee holds unless you turn this on.
package config

import (
	"fmt"
	"os"
	"time"
)

// Config holds all runtime configuration for the billsyncd worker.
type Config struct {
	ClickHouseDSN string
	OrgSlug       string

	SyncInterval time.Duration
	LookbackDays int

	HTTPAddr string

	// Provider admin keys. Empty = provider disabled.
	OpenAIAdminKey    string
	AnthropicAdminKey string

	// Overridable base URLs (tests, proxies, air-gapped mirrors).
	OpenAIBaseURL    string
	AnthropicBaseURL string
}

// Load reads configuration from the environment, applying defaults.
func Load() (*Config, error) {
	c := &Config{
		ClickHouseDSN:     os.Getenv("COSTOBS_CLICKHOUSE_DSN"),
		OrgSlug:           getEnv("COSTOBS_ORG_SLUG", "default"),
		SyncInterval:      6 * time.Hour,
		LookbackDays:      30,
		HTTPAddr:          getEnv("COSTOBS_HTTP_ADDR", ":8082"),
		OpenAIAdminKey:    os.Getenv("COSTOBS_BILLING_OPENAI_ADMIN_KEY"),
		AnthropicAdminKey: os.Getenv("COSTOBS_BILLING_ANTHROPIC_ADMIN_KEY"),
		OpenAIBaseURL:     getEnv("COSTOBS_BILLING_OPENAI_BASE_URL", "https://api.openai.com"),
		AnthropicBaseURL:  getEnv("COSTOBS_BILLING_ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
	}

	if c.ClickHouseDSN == "" {
		return nil, fmt.Errorf("COSTOBS_CLICKHOUSE_DSN is required")
	}

	if v := os.Getenv("COSTOBS_SYNC_INTERVAL"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d <= 0 {
			return nil, fmt.Errorf("invalid COSTOBS_SYNC_INTERVAL %q: must be a positive Go duration", v)
		}
		c.SyncInterval = d
	}
	if v := os.Getenv("COSTOBS_SYNC_LOOKBACK_DAYS"); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err != nil || n <= 0 || n > 365 {
			return nil, fmt.Errorf("invalid COSTOBS_SYNC_LOOKBACK_DAYS %q: must be 1-365", v)
		}
		c.LookbackDays = n
	}

	return c, nil
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
