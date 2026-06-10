// Package chwriter provides a ClickHouse bulk writer for telemetry events.
package chwriter

import (
	"context"
	"fmt"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"

	"github.com/officialasishkumar/costobs/services/ingest/internal/model"
)

// Writer inserts batches of events into the durable store. It is mocked behind
// this interface in tests so the rest of the service runs offline.
type Writer interface {
	// Insert writes the batch. It must be safe to call concurrently.
	Insert(ctx context.Context, events []model.Event) error
	// Ping checks store reachability (used by /healthz).
	Ping(ctx context.Context) error
	// Close releases the underlying connection.
	Close() error
}

const insertSQL = `INSERT INTO events (
	request_id, org_id, ts,
	provider, model, operation, stream, status, error_type,
	environment, team, service, customer_id, user_id, trace_id, feature, prompt_key, prompt_version, tags,
	input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, tool_tokens, total_tokens, audio_seconds, characters, image_count, image_tiles,
	cost_usd, pricing_version,
	latency_ms, sdk_lang, sdk_version
)`

// ClickHouseWriter is the production Writer backed by clickhouse-go/v2.
type ClickHouseWriter struct {
	conn driver.Conn
}

// Open dials ClickHouse using a DSN such as
// clickhouse://user:pass@host:9000/db and verifies connectivity.
func Open(ctx context.Context, dsn string) (*ClickHouseWriter, error) {
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
	return &ClickHouseWriter{conn: conn}, nil
}

// Ping checks ClickHouse reachability.
func (w *ClickHouseWriter) Ping(ctx context.Context) error {
	return w.conn.Ping(ctx)
}

// Close closes the ClickHouse connection.
func (w *ClickHouseWriter) Close() error {
	return w.conn.Close()
}

// Insert bulk-inserts a batch of events.
func (w *ClickHouseWriter) Insert(ctx context.Context, events []model.Event) error {
	if len(events) == 0 {
		return nil
	}
	batch, err := w.conn.PrepareBatch(ctx, insertSQL)
	if err != nil {
		return fmt.Errorf("prepare batch: %w", err)
	}
	for i := range events {
		e := &events[i]
		tags := e.Tags
		if tags == nil {
			tags = map[string]string{}
		}
		stream := uint8(0)
		if e.Stream {
			stream = 1
		}
		if err := batch.Append(
			e.RequestID, e.OrgID, e.TS,
			e.Provider, e.Model, e.Operation, stream, e.Status, e.ErrorType,
			e.Environment, e.Team, e.Service, e.CustomerID, e.UserID, e.TraceID, e.Feature, e.PromptKey, e.PromptVersion, tags,
			e.InputTokens, e.CachedInputTokens, e.OutputTokens, e.ReasoningTokens, e.ToolTokens, e.TotalTokens, e.AudioSeconds, e.Characters, e.ImageCount, e.ImageTiles,
			e.CostUsd, e.PricingVersion,
			e.LatencyMs, e.SDKLang, e.SDKVersion,
		); err != nil {
			_ = batch.Abort()
			return fmt.Errorf("append row %d: %w", i, err)
		}
	}
	if err := batch.Send(); err != nil {
		return fmt.Errorf("send batch: %w", err)
	}
	return nil
}

// RetryInsert calls w.Insert with bounded exponential backoff. It returns the
// last error if all attempts fail or ctx is cancelled.
func RetryInsert(ctx context.Context, w Writer, events []model.Event, attempts int, base time.Duration) error {
	var err error
	backoff := base
	for i := 0; i < attempts; i++ {
		if err = w.Insert(ctx, events); err == nil {
			return nil
		}
		if i == attempts-1 {
			break
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > 5*time.Second {
			backoff = 5 * time.Second
		}
	}
	return err
}
