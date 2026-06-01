// Package metrics defines the Prometheus collectors for the alertd worker.
package metrics

import "github.com/prometheus/client_golang/prometheus"

// Metrics bundles all collectors. They are registered into a private registry
// so tests can construct independent instances without global state clashes.
type Metrics struct {
	Registry *prometheus.Registry

	RulesEvaluated   prometheus.Counter
	AlertsFired      prometheus.Counter
	DeliveriesFailed prometheus.Counter

	EvalDuration prometheus.Histogram
}

// New builds a Metrics with a fresh registry and registers all collectors.
func New() *Metrics {
	reg := prometheus.NewRegistry()
	m := &Metrics{
		Registry: reg,
		RulesEvaluated: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "costobs_alertd_rules_evaluated_total",
			Help: "Total alert rules evaluated.",
		}),
		AlertsFired: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "costobs_alertd_alerts_fired_total",
			Help: "Total alerts fired (threshold breached and not in cooldown).",
		}),
		DeliveriesFailed: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "costobs_alertd_deliveries_failed_total",
			Help: "Total target deliveries that failed after all retries.",
		}),
		EvalDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "costobs_alertd_eval_duration_seconds",
			Help:    "Duration of a full evaluation cycle across all rules.",
			Buckets: prometheus.DefBuckets,
		}),
	}

	reg.MustRegister(
		m.RulesEvaluated,
		m.AlertsFired,
		m.DeliveriesFailed,
		m.EvalDuration,
	)
	return m
}
