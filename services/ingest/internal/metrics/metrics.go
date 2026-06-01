// Package metrics defines the Prometheus collectors for the ingest service.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

// Metrics bundles all collectors. They are registered into a private registry
// so tests can construct independent instances without global state clashes.
type Metrics struct {
	Registry *prometheus.Registry

	EventsReceived prometheus.Counter
	EventsInserted prometheus.Counter
	EventsDropped  prometheus.Counter
	BatchesFlushed prometheus.Counter
	AuthFailures   prometheus.Counter

	BufferDepth prometheus.Gauge

	InsertDuration prometheus.Histogram
	BatchSize      prometheus.Histogram
}

// New builds a Metrics with a fresh registry and registers all collectors.
func New() *Metrics {
	reg := prometheus.NewRegistry()
	m := &Metrics{
		Registry: reg,
		EventsReceived: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "costobs_ingest_events_received_total",
			Help: "Total telemetry events received over HTTP.",
		}),
		EventsInserted: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "costobs_ingest_events_inserted_total",
			Help: "Total events successfully inserted into ClickHouse.",
		}),
		EventsDropped: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "costobs_ingest_events_dropped_total",
			Help: "Total events dropped (duplicates or backpressure).",
		}),
		BatchesFlushed: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "costobs_ingest_batches_flushed_total",
			Help: "Total batches flushed to ClickHouse.",
		}),
		AuthFailures: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "costobs_ingest_auth_failures_total",
			Help: "Total authentication failures.",
		}),
		BufferDepth: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "costobs_ingest_buffer_depth",
			Help: "Current number of events buffered awaiting flush.",
		}),
		InsertDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "costobs_ingest_insert_duration_seconds",
			Help:    "Duration of ClickHouse bulk inserts.",
			Buckets: prometheus.DefBuckets,
		}),
		BatchSize: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "costobs_ingest_batch_size",
			Help:    "Number of events per flushed batch.",
			Buckets: []float64{1, 10, 50, 100, 250, 500, 1000, 2500, 5000},
		}),
	}

	reg.MustRegister(
		m.EventsReceived,
		m.EventsInserted,
		m.EventsDropped,
		m.BatchesFlushed,
		m.AuthFailures,
		m.BufferDepth,
		m.InsertDuration,
		m.BatchSize,
	)
	return m
}
