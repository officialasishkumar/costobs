// Package store persists synced billing rows into ClickHouse billed_daily.
package store

import (
	"context"
	"fmt"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/shopspring/decimal"
)

// Row is one (org, provider, day) of billed spend.
type Row struct {
	OrgID     string
	Provider  string
	Date      time.Time
	BilledUSD decimal.Decimal
	Source    string // "api" | "import"
}

// Store abstracts the ClickHouse sink so the worker is testable offline.
type Store interface {
	Upsert(ctx context.Context, rows []Row) error
	Ping(ctx context.Context) error
	Close() error
}

// CHStore is the production Store backed by clickhouse-go/v2.
type CHStore struct {
	conn driver.Conn
}

// Open dials ClickHouse using a DSN such as clickhouse://user:pass@host:9000/db.
func Open(ctx context.Context, dsn string) (*CHStore, error) {
	opts, err := clickhouse.ParseDSN(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse clickhouse dsn: %w", err)
	}
	conn, err := clickhouse.Open(opts)
	if err != nil {
		return nil, fmt.Errorf("open clickhouse: %w", err)
	}
	if err := conn.Ping(ctx); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("ping clickhouse: %w", err)
	}
	return &CHStore{conn: conn}, nil
}

// Ping checks ClickHouse reachability.
func (s *CHStore) Ping(ctx context.Context) error { return s.conn.Ping(ctx) }

// Close releases the connection.
func (s *CHStore) Close() error { return s.conn.Close() }

// Upsert inserts rows; the ReplacingMergeTree(synced_at) engine keeps the
// newest row per (org_id, provider, date), so re-syncing is idempotent.
func (s *CHStore) Upsert(ctx context.Context, rows []Row) error {
	if len(rows) == 0 {
		return nil
	}
	batch, err := s.conn.PrepareBatch(ctx,
		`INSERT INTO billed_daily (org_id, provider, date, billed_usd, source, synced_at)`)
	if err != nil {
		return fmt.Errorf("prepare batch: %w", err)
	}
	now := time.Now().UTC()
	for i, r := range rows {
		source := r.Source
		if source == "" {
			source = "api"
		}
		if err := batch.Append(r.OrgID, r.Provider, r.Date, r.BilledUSD, source, now); err != nil {
			_ = batch.Abort()
			return fmt.Errorf("append row %d: %w", i, err)
		}
	}
	if err := batch.Send(); err != nil {
		return fmt.Errorf("send batch: %w", err)
	}
	return nil
}
