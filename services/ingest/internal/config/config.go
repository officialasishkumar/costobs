// Package config parses the ingest service configuration from environment
// variables.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds all runtime configuration for the ingest service.
type Config struct {
	HTTPAddr string

	ClickHouseDSN string
	PostgresDSN   string

	BatchMaxEvents   int
	BatchMaxInterval time.Duration

	DevSeed    bool
	DevAPIKey  string
	DevOrgSlug string
}

// Load reads configuration from the environment, applying defaults.
func Load() (*Config, error) {
	c := &Config{
		HTTPAddr:         getEnv("COSTOBS_HTTP_ADDR", ":8080"),
		ClickHouseDSN:    os.Getenv("COSTOBS_CLICKHOUSE_DSN"),
		PostgresDSN:      os.Getenv("COSTOBS_POSTGRES_DSN"),
		BatchMaxEvents:   1000,
		BatchMaxInterval: 2 * time.Second,
		DevSeed:          os.Getenv("COSTOBS_DEV_SEED") == "true",
		DevAPIKey:        os.Getenv("COSTOBS_DEV_API_KEY"),
		DevOrgSlug:       getEnv("COSTOBS_DEV_ORG_SLUG", "default"),
	}

	if v := os.Getenv("COSTOBS_BATCH_MAX_EVENTS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			return nil, fmt.Errorf("invalid COSTOBS_BATCH_MAX_EVENTS %q: must be a positive integer", v)
		}
		c.BatchMaxEvents = n
	}

	if v := os.Getenv("COSTOBS_BATCH_MAX_INTERVAL"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d <= 0 {
			return nil, fmt.Errorf("invalid COSTOBS_BATCH_MAX_INTERVAL %q: %v", v, err)
		}
		c.BatchMaxInterval = d
	}

	return c, nil
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
