// Command ingest is the CostObs telemetry ingestion service.
//
// Subcommands:
//
//	ingest serve   start the HTTP server (default)
//	ingest seed    run the idempotent dev seed once and exit
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

	"github.com/officialasishkumar/costobs/services/ingest/internal/auth"
	"github.com/officialasishkumar/costobs/services/ingest/internal/batch"
	"github.com/officialasishkumar/costobs/services/ingest/internal/chwriter"
	"github.com/officialasishkumar/costobs/services/ingest/internal/config"
	"github.com/officialasishkumar/costobs/services/ingest/internal/dedup"
	"github.com/officialasishkumar/costobs/services/ingest/internal/httpapi"
	"github.com/officialasishkumar/costobs/services/ingest/internal/metrics"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}

	cfg, err := config.Load()
	if err != nil {
		log.Error("load config", "error", err)
		os.Exit(1)
	}

	switch cmd {
	case "serve":
		if err := runServe(cfg, log); err != nil {
			log.Error("serve failed", "error", err)
			os.Exit(1)
		}
	case "seed":
		if err := runSeed(cfg, log); err != nil {
			log.Error("seed failed", "error", err)
			os.Exit(1)
		}
	default:
		log.Error("unknown subcommand", "cmd", cmd, "valid", []string{"serve", "seed"})
		os.Exit(2)
	}
}

func runSeed(cfg *config.Config, log *slog.Logger) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pg, err := auth.NewPGStore(ctx, cfg.PostgresDSN)
	if err != nil {
		return err
	}
	defer pg.Close()

	return pg.Seed(ctx, cfg.DevOrgSlug, cfg.DevAPIKey, log)
}

func runServe(cfg *config.Config, log *slog.Logger) error {
	ctx := context.Background()

	m := metrics.New()

	// Postgres (auth store).
	pg, err := auth.NewPGStore(ctx, cfg.PostgresDSN)
	if err != nil {
		return err
	}
	defer pg.Close()

	// Optional dev seed on boot.
	if cfg.DevSeed {
		sctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		if err := pg.Seed(sctx, cfg.DevOrgSlug, cfg.DevAPIKey, log); err != nil {
			cancel()
			return err
		}
		cancel()
	}

	// ClickHouse writer.
	chCtx, chCancel := context.WithTimeout(ctx, 30*time.Second)
	ch, err := chwriter.Open(chCtx, cfg.ClickHouseDSN)
	chCancel()
	if err != nil {
		return err
	}
	defer ch.Close()

	authn := auth.NewAuthenticator(pg, 60*time.Second)

	dd := dedup.New(5 * time.Minute)
	stopDedup := make(chan struct{})
	go dd.Run(stopDedup, time.Minute)
	defer close(stopDedup)

	buf := batch.New(ch, m, log, batch.Options{
		MaxEvents:   cfg.BatchMaxEvents,
		MaxInterval: cfg.BatchMaxInterval,
	})
	go buf.Run()

	srv := httpapi.New(httpapi.Config{
		Auth:           authn,
		Buffer:         buf,
		Dedup:          dd,
		Metrics:        m,
		Log:            log,
		ClickHouse:     ch,
		Postgres:       pg,
		MaxBatchEvents: cfg.BatchMaxEvents * 10,
	})

	httpServer := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Graceful shutdown.
	sigCtx, stop := signal.NotifyContext(ctx, syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		log.Info("ingest listening", "addr", cfg.HTTPAddr,
			"batch_max_events", cfg.BatchMaxEvents, "batch_max_interval", cfg.BatchMaxInterval.String())
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-sigCtx.Done():
		log.Info("shutdown signal received, draining")
	}

	// Stop accepting new requests.
	shutCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutCtx); err != nil {
		log.Error("http shutdown error", "error", err)
	}

	// Drain the buffer to ClickHouse.
	buf.Shutdown(shutCtx)
	log.Info("drained; exiting")
	return nil
}
