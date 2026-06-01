// Command alertd is the CostObs periodic alert evaluator.
//
// Every COSTOBS_EVAL_INTERVAL it loads enabled alert rules from Postgres,
// queries ClickHouse for each rule's current spend, and fires webhook / Slack
// notifications when a threshold is breached, honoring per-rule cooldown.
//
// It also serves GET /healthz and GET /metrics (Prometheus) on COSTOBS_HTTP_ADDR
// (default :8081).
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

	"github.com/officialasishkumar/costobs/services/alertd/internal/config"
	"github.com/officialasishkumar/costobs/services/alertd/internal/deliver"
	"github.com/officialasishkumar/costobs/services/alertd/internal/eval"
	"github.com/officialasishkumar/costobs/services/alertd/internal/metrics"
	"github.com/officialasishkumar/costobs/services/alertd/internal/rules"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := config.Load()
	if err != nil {
		log.Error("load config", "error", err)
		os.Exit(1)
	}

	if err := run(cfg, log); err != nil {
		log.Error("alertd failed", "error", err)
		os.Exit(1)
	}
}

func run(cfg *config.Config, log *slog.Logger) error {
	ctx := context.Background()
	m := metrics.New()

	connCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	store, err := rules.NewPGStore(connCtx, cfg.PostgresDSN)
	if err != nil {
		return err
	}
	defer store.Close()

	ch, err := eval.OpenClickHouse(connCtx, cfg.ClickHouseDSN)
	if err != nil {
		return err
	}
	defer ch.Close()

	dispatcher := deliver.New(nil)

	w := &worker{
		store:      store,
		ch:         ch,
		dispatcher: dispatcher,
		metrics:    m,
		log:        log,
		now:        func() time.Time { return time.Now().UTC() },
	}

	// HTTP server: /healthz + /metrics.
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(rw http.ResponseWriter, r *http.Request) {
		hctx, hcancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer hcancel()
		if err := store.Ping(hctx); err != nil {
			http.Error(rw, "postgres unavailable", http.StatusServiceUnavailable)
			return
		}
		if err := ch.Ping(hctx); err != nil {
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
		log.Info("alertd http listening", "addr", cfg.HTTPAddr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	// Evaluation ticker loop.
	ticker := time.NewTicker(cfg.EvalInterval)
	defer ticker.Stop()

	log.Info("alertd started", "eval_interval", cfg.EvalInterval.String())

	// Evaluate once immediately so the first cycle does not wait a full interval.
	w.evaluateOnce(sigCtx)

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
			log.Info("exiting")
			return nil
		case <-ticker.C:
			w.evaluateOnce(sigCtx)
		}
	}
}

// worker holds the dependencies for one evaluation cycle.
type worker struct {
	store      rules.Store
	ch         eval.QueryRunner
	dispatcher *deliver.Dispatcher
	metrics    *metrics.Metrics
	log        *slog.Logger
	now        func() time.Time
}

// evaluateOnce runs a single full evaluation cycle. It never returns an error:
// failures are logged and metered so a bad rule or a flaky dependency cannot
// crash the worker or block other rules.
func (w *worker) evaluateOnce(ctx context.Context) {
	start := time.Now()
	defer func() {
		w.metrics.EvalDuration.Observe(time.Since(start).Seconds())
	}()

	loaded, err := w.store.LoadEnabledRules(ctx)
	if err != nil {
		w.log.Error("load enabled rules", "error", err)
		return
	}

	now := w.now()
	for i := range loaded {
		w.evaluateRule(ctx, &loaded[i], now)
	}
}

func (w *worker) evaluateRule(ctx context.Context, r *rules.Rule, now time.Time) {
	w.metrics.RulesEvaluated.Inc()
	log := w.log.With("rule_id", r.ID, "rule_name", r.Name, "org", r.OrgSlug, "kind", r.Kind)

	if r.InCooldown(now) {
		log.Debug("skipping rule in cooldown", "last_fired_at", r.LastFiredAt)
		return
	}

	er, err := toEvalRule(r)
	if err != nil {
		log.Error("invalid rule config", "error", err)
		return
	}

	res, err := eval.Evaluate(ctx, w.ch, er, now)
	if err != nil {
		log.Error("evaluate rule", "error", err)
		return
	}
	if !res.Breached {
		return
	}

	w.metrics.AlertsFired.Inc()
	firedAt := now
	log.Info("alert fired",
		"observed_usd", res.ObservedUSD, "threshold_usd", res.ThresholdUSD)

	payload := deliver.Payload{
		RuleID:       r.ID,
		RuleName:     r.Name,
		OrgSlug:      r.OrgSlug,
		Kind:         r.Kind,
		ObservedUSD:  res.ObservedUSD,
		ThresholdUSD: res.ThresholdUSD,
		Scope:        r.Scope,
		FiredAt:      firedAt,
	}

	for _, t := range r.Targets {
		if err := w.dispatcher.Deliver(ctx, deliver.Target{Kind: t.Kind, Config: t.Config}, payload); err != nil {
			w.metrics.DeliveriesFailed.Inc()
			log.Error("deliver alert", "target_kind", t.Kind, "target_id", t.ID, "error", err)
		}
	}

	// Persist last_fired_at even if some deliveries failed, so the cooldown is
	// honored and we do not spam on every interval.
	if err := w.store.MarkFired(ctx, r.ID, firedAt); err != nil {
		log.Error("mark fired", "error", err)
	}
	r.LastFiredAt = &firedAt
}

// toEvalRule maps a loaded rules.Rule into the eval.Rule the evaluator needs,
// extracting and validating kind-specific config from the JSONB map.
func toEvalRule(r *rules.Rule) (eval.Rule, error) {
	er := eval.Rule{
		OrgSlug: r.OrgSlug,
		Kind:    r.Kind,
		Scope:   r.Scope,
	}
	switch r.Kind {
	case eval.KindDailyThreshold:
		v, err := configFloat(r.Config, "threshold_usd")
		if err != nil {
			return eval.Rule{}, err
		}
		er.ThresholdUSD = v
	case eval.KindMonthlyBudget:
		v, err := configFloat(r.Config, "budget_usd")
		if err != nil {
			return eval.Rule{}, err
		}
		er.BudgetUSD = v
	case eval.KindSpike:
		v, err := configFloat(r.Config, "factor")
		if err != nil {
			return eval.Rule{}, err
		}
		er.Factor = v
		if b, ok := r.Config["baseline"].(string); ok {
			er.Baseline = b
		} else {
			er.Baseline = eval.BaselineRolling7d
		}
	default:
		return eval.Rule{}, errUnknownKind(r.Kind)
	}
	return er, nil
}

func configFloat(cfg map[string]any, key string) (float64, error) {
	v, ok := cfg[key]
	if !ok {
		return 0, errMissingConfig(key)
	}
	// JSON numbers decode into float64 via encoding/json.
	f, ok := v.(float64)
	if !ok {
		return 0, errBadConfigType(key)
	}
	return f, nil
}
