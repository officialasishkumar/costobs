// Package costobs is the CostObs Go SDK — drop-in AI/LLM cost observability.
//
// Wrap any provider SDK that rides on net/http with the observing transport:
//
//	co := costobs.New(costobs.Config{
//		IngestURL: "http://localhost:8080",
//		APIKey:    "costobs_dev_secret_key",
//		Team:      "payments", Environment: "prod",
//	})
//	defer co.Close()
//
//	httpClient := &http.Client{Transport: co.Transport(nil)}
//	oai := openai.NewClient(option.WithHTTPClient(httpClient))
//
//	ctx := costobs.WithMetadata(ctx, costobs.Metadata{
//		CustomerID: "cust-42", Feature: "chat",
//	})
//	resp, err := oai.Chat.Completions.New(ctx, ...)
//
// The provider call always runs first; cost calculation happens after the
// response and shipping happens on a background goroutine. Only metadata is
// recorded — never prompt or response content.
package costobs

import (
	"context"
	"log/slog"
	"os"
	"time"
)

// Config configures a Client. Zero values fall back to environment variables
// COSTOBS_INGEST_URL / COSTOBS_API_KEY and sane defaults.
type Config struct {
	IngestURL string
	APIKey    string

	// Default attribution stamped on every event from this client.
	Environment string
	Team        string
	Service     string
	Tags        map[string]string

	BatchSize     int           // default 100
	FlushInterval time.Duration // default 1s
	Logger        *slog.Logger  // default slog.Default()
}

// Client owns the pricing engine and the async telemetry queue.
type Client struct {
	cfg     Config
	pricing *PricingEngine
	q       *queue
}

// New builds a Client and starts its background sender.
func New(cfg Config) *Client {
	if cfg.IngestURL == "" {
		cfg.IngestURL = os.Getenv("COSTOBS_INGEST_URL")
	}
	if cfg.IngestURL == "" {
		cfg.IngestURL = "http://localhost:8080"
	}
	if cfg.APIKey == "" {
		cfg.APIKey = os.Getenv("COSTOBS_API_KEY")
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	return &Client{
		cfg:     cfg,
		pricing: DefaultPricing(),
		q:       newQueue(cfg.IngestURL, cfg.APIKey, cfg.BatchSize, cfg.FlushInterval, cfg.Logger),
	}
}

// Flush blocks until buffered events are shipped (or ctx expires).
func (c *Client) Flush(ctx context.Context) bool { return c.q.flushWait(ctx) }

// Close drains and stops the background sender. Idempotent.
func (c *Client) Close() { c.q.close() }

// RecordOptions describes one manually-recorded billable call — for anything
// the transport can't observe (gRPC providers, batch jobs, audio seconds).
type RecordOptions struct {
	Provider  string
	Model     string
	Operation string // default "chat"
	Status    string // default "ok"
	ErrorType string
	Stream    bool
	LatencyMs int

	Usage Usage

	// CostUSD overrides the local pricing calculation when set (> 0 or
	// explicitly forced with ForceCost).
	CostUSD   float64
	ForceCost bool

	Metadata Metadata
}

// Record prices and enqueues one event. Non-blocking; never returns an error.
func (c *Client) Record(ctx context.Context, opts RecordOptions) {
	if opts.Operation == "" {
		opts.Operation = "chat"
	}
	if opts.Status == "" {
		opts.Status = "ok"
	}
	cost := opts.CostUSD
	if !opts.ForceCost && cost == 0 {
		cost, _ = c.pricing.Cost(opts.Usage, opts.Provider, opts.Model).Float64()
	}
	meta := c.resolveMeta(ctx, opts.Metadata)
	c.q.enqueue(Event{
		RequestID:         newRequestID(),
		TS:                utcNowISO(),
		Provider:          opts.Provider,
		Model:             opts.Model,
		Operation:         opts.Operation,
		Stream:            opts.Stream,
		Status:            opts.Status,
		ErrorType:         opts.ErrorType,
		Environment:       meta.Environment,
		Team:              meta.Team,
		Service:           meta.Service,
		CustomerID:        meta.CustomerID,
		UserID:            meta.UserID,
		TraceID:           meta.TraceID,
		Feature:           meta.Feature,
		PromptKey:         meta.PromptKey,
		PromptVersion:     meta.PromptVersion,
		Tags:              nonNilTags(meta.Tags),
		InputTokens:       opts.Usage.InputTokens,
		CachedInputTokens: opts.Usage.CachedInputTokens,
		OutputTokens:      opts.Usage.OutputTokens,
		ReasoningTokens:   opts.Usage.ReasoningTokens,
		ToolTokens:        opts.Usage.ToolTokens,
		TotalTokens:       opts.Usage.totalOrDerived(),
		AudioSeconds:      opts.Usage.AudioSeconds,
		Characters:        opts.Usage.Characters,
		ImageCount:        opts.Usage.ImageCount,
		ImageTiles:        opts.Usage.ImageTiles,
		CostUSD:           cost,
		PricingVersion:    c.pricing.Version,
		LatencyMs:         opts.LatencyMs,
		SDKLang:           sdkLang,
		SDKVersion:        SDKVersion,
	})
}

// resolveMeta layers: client config < context < explicit override.
func (c *Client) resolveMeta(ctx context.Context, over Metadata) Metadata {
	base := Metadata{
		Environment: c.cfg.Environment,
		Team:        c.cfg.Team,
		Service:     c.cfg.Service,
		Tags:        c.cfg.Tags,
	}
	return mergeMetadata(mergeMetadata(base, MetadataFrom(ctx)), over)
}

func nonNilTags(t map[string]string) map[string]string {
	if t == nil {
		return map[string]string{}
	}
	return t
}
