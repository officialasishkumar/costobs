package eval

import (
	"context"
	"fmt"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/shopspring/decimal"
)

// CHRunner is the production QueryRunner backed by clickhouse-go/v2.
type CHRunner struct {
	conn driver.Conn
}

// OpenClickHouse dials ClickHouse using a DSN such as
// clickhouse://user:pass@host:9000/db and verifies connectivity.
func OpenClickHouse(ctx context.Context, dsn string) (*CHRunner, error) {
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
	return &CHRunner{conn: conn}, nil
}

// Ping checks ClickHouse reachability.
func (r *CHRunner) Ping(ctx context.Context) error { return r.conn.Ping(ctx) }

// Close releases the underlying connection.
func (r *CHRunner) Close() error { return r.conn.Close() }

// SumCost runs the supplied sum(cost_usd) query and returns the result as a
// float64. cost_usd is a Decimal in ClickHouse, so it is scanned into a
// decimal and converted; a NULL sum (no matching rows) yields 0.
func (r *CHRunner) SumCost(ctx context.Context, query string, args ...any) (float64, error) {
	// sum() over Decimal returns Decimal; over no rows it is NULL, so scan into
	// a nullable decimal.
	var v decimal.NullDecimal
	if err := r.conn.QueryRow(ctx, query, args...).Scan(&v); err != nil {
		return 0, fmt.Errorf("clickhouse sum query: %w", err)
	}
	if !v.Valid {
		return 0, nil
	}
	f, _ := v.Decimal.Float64()
	return f, nil
}
