// Command billsyncd syncs ACTUAL billed cost from provider admin APIs into
// ClickHouse `billed_daily`, powering the dashboard's reconciliation view
// (tracked SDK estimates vs. real bills, drift, untracked spend).
//
// Opt-in by design: this is the only CostObs component that makes outbound
// calls, and only for providers whose admin keys are configured
// (COSTOBS_BILLING_OPENAI_ADMIN_KEY, COSTOBS_BILLING_ANTHROPIC_ADMIN_KEY).
// With no keys it idles healthily and never leaves the network.
//
// Serves GET /healthz and GET /metrics on COSTOBS_HTTP_ADDR (default :8082).
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/officialasishkumar/costobs/services/billsyncd/internal/config"
	"github.com/officialasishkumar/costobs/services/billsyncd/internal/metrics"
	"github.com/officialasishkumar/costobs/services/billsyncd/internal/providers"
	"github.com/officialasishkumar/costobs/services/billsyncd/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := config.Load()
	if err != nil {
		log.Error("load config", "error", err)
		os.Exit(1)
	}

	if err := run(cfg, log); err != nil {
		log.Error("billsyncd failed", "error", err)
		os.Exit(1)
	}
}

func buildFetchers(cfg *config.Config) []providers.Fetcher {
	var out []providers.Fetcher
	if cfg.OpenAIAdminKey != "" {
		out = append(out, providers.NewOpenAI(cfg.OpenAIBaseURL, cfg.OpenAIAdminKey))
	}
	if cfg.AnthropicAdminKey != "" {
		out = append(out, providers.NewAnthropic(cfg.AnthropicBaseURL, cfg.AnthropicAdminKey))
	}
	return out
}

func run(cfg *config.Config, log *slog.Logger) error {
	ctx := context.Background()
	m := metrics.New()

	connCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	st, err := store.Open(connCtx, cfg.ClickHouseDSN)
	if err != nil {
		return err
	}
	defer st.Close()

	w := &worker{
		store:        st,
		fetchers:     buildFetchers(cfg),
		orgSlug:      cfg.OrgSlug,
		lookbackDays: cfg.LookbackDays,
		metrics:      m,
		log:          log,
		now:          func() time.Time { return time.Now().UTC() },
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(rw http.ResponseWriter, r *http.Request) {
		hctx, hcancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer hcancel()
		if err := st.Ping(hctx); err != nil {
			http.Error(rw, "clickhouse unavailable", http.StatusServiceUnavailable)
			return
		}
		rw.WriteHeader(http.StatusOK)
		_, _ = rw.Write([]byte("ok"))
	})
	mux.Handle("GET /metrics", promhttp.HandlerFor(m.Registry, promhttp.HandlerOpts{}))

	httpServer := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	sigCtx, stop := signal.NotifyContext(ctx, syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		log.Info("billsyncd http listening", "addr", cfg.HTTPAddr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	if len(w.fetchers) == 0 {
		log.Info("no provider billing keys configured; billsyncd will idle " +
			"(set COSTOBS_BILLING_OPENAI_ADMIN_KEY / COSTOBS_BILLING_ANTHROPIC_ADMIN_KEY to enable)")
	}

	ticker := time.NewTicker(cfg.SyncInterval)
	defer ticker.Stop()

	log.Info("billsyncd started",
		"sync_interval", cfg.SyncInterval.String(),
		"lookback_days", cfg.LookbackDays,
		"providers", len(w.fetchers))

	w.syncOnce(sigCtx)

	for {
		select {
		case err := <-errCh:
			return err
		case <-sigCtx.Done():
			log.Info("shutdown signal received")
			shutCtx, shutCancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer shutCancel()
			if err := httpServer.Shutdown(shutCtx); err != nil {
				log.Error("http shutdown error", "error", err)
			}
			return nil
		case <-ticker.C:
			w.syncOnce(sigCtx)
		}
	}
}

// worker holds the dependencies for one sync cycle.
type worker struct {
	store        store.Store
	fetchers     []providers.Fetcher
	orgSlug      string
	lookbackDays int
	metrics      *metrics.Metrics
	log          *slog.Logger
	now          func() time.Time
}

// syncOnce runs a full sync cycle. It never returns an error: failures are
// logged and metered so one flaky provider cannot block the others.
func (w *worker) syncOnce(ctx context.Context) {
	if len(w.fetchers) == 0 {
		return
	}
	start := time.Now()
	w.metrics.SyncsTotal.Inc()
	defer func() {
		w.metrics.SyncDuration.Observe(time.Since(start).Seconds())
	}()

	now := w.now()
	from := now.AddDate(0, 0, -w.lookbackDays)

	for _, f := range w.fetchers {
		log := w.log.With("provider", f.Name())
		fctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		daily, err := f.FetchDaily(fctx, from, now)
		cancel()
		if err != nil {
			w.metrics.FetchErrors.Inc()
			log.Error("fetch billed cost", "error", err)
			continue
		}
		rows := make([]store.Row, 0, len(daily))
		for _, d := range daily {
			rows = append(rows, store.Row{
				OrgID:     w.orgSlug,
				Provider:  f.Name(),
				Date:      d.Date,
				BilledUSD: d.USD,
				Source:    "api",
			})
		}
		uctx, ucancel := context.WithTimeout(ctx, 30*time.Second)
		err = w.store.Upsert(uctx, rows)
		ucancel()
		if err != nil {
			w.metrics.FetchErrors.Inc()
			log.Error("upsert billed_daily", "error", err)
			continue
		}
		w.metrics.RowsUpserted.Add(float64(len(rows)))
		log.Info("synced billed cost", "days", len(rows))
	}
}
