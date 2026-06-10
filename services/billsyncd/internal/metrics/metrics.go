// Package metrics defines the Prometheus collectors for the billsyncd worker.
package metrics

import "github.com/prometheus/client_golang/prometheus"

// Metrics bundles all collectors in a private registry (test-friendly).
type Metrics struct {
	Registry *prometheus.Registry

	SyncsTotal   prometheus.Counter
	FetchErrors  prometheus.Counter
	RowsUpserted prometheus.Counter
	SyncDuration prometheus.Histogram
}

// New builds a Metrics with a fresh registry and registers all collectors.
func New() *Metrics {
	reg := prometheus.NewRegistry()
	m := &Metrics{
		Registry: reg,
		SyncsTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "costobs_billsyncd_syncs_total",
			Help: "Total sync cycles attempted.",
		}),
		FetchErrors: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "costobs_billsyncd_fetch_errors_total",
			Help: "Total provider fetch failures.",
		}),
		RowsUpserted: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "costobs_billsyncd_rows_upserted_total",
			Help: "Total billed_daily rows written.",
		}),
		SyncDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "costobs_billsyncd_sync_duration_seconds",
			Help:    "Duration of a full sync cycle across all providers.",
			Buckets: prometheus.DefBuckets,
		}),
	}
	reg.MustRegister(m.SyncsTotal, m.FetchErrors, m.RowsUpserted, m.SyncDuration)
	return m
}
