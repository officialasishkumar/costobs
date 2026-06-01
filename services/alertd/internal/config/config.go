// Package config parses the alertd service configuration from environment
// variables.
package config

import (
	"fmt"
	"os"
	"time"
)

// Config holds all runtime configuration for the alertd worker.
type Config struct {
	ClickHouseDSN string
	PostgresDSN   string

	EvalInterval time.Duration

	HTTPAddr string
}

// Load reads configuration from the environment, applying defaults. It returns
// an error if a required value is missing or a duration fails to parse.
func Load() (*Config, error) {
	c := &Config{
		ClickHouseDSN: os.Getenv("COSTOBS_CLICKHOUSE_DSN"),
		PostgresDSN:   os.Getenv("COSTOBS_POSTGRES_DSN"),
		EvalInterval:  60 * time.Second,
		HTTPAddr:      getEnv("COSTOBS_HTTP_ADDR", ":8081"),
	}

	if c.ClickHouseDSN == "" {
		return nil, fmt.Errorf("COSTOBS_CLICKHOUSE_DSN is required")
	}
	if c.PostgresDSN == "" {
		return nil, fmt.Errorf("COSTOBS_POSTGRES_DSN is required")
	}

	if v := os.Getenv("COSTOBS_EVAL_INTERVAL"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d <= 0 {
			return nil, fmt.Errorf("invalid COSTOBS_EVAL_INTERVAL %q: must be a positive Go duration", v)
		}
		c.EvalInterval = d
	}

	return c, nil
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
