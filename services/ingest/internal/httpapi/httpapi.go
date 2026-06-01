// Package httpapi wires the ingest HTTP handlers, routing, and middleware.
package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/officialasishkumar/costobs/services/ingest/internal/dedup"
	"github.com/officialasishkumar/costobs/services/ingest/internal/metrics"
	"github.com/officialasishkumar/costobs/services/ingest/internal/model"
)

// Enqueuer accepts events into the buffer, signalling backpressure.
type Enqueuer interface {
	Add(events []model.Event) (accepted int, full bool)
}

// Pinger checks a backend dependency's reachability.
type Pinger interface {
	Ping(ctx context.Context) error
}

// Authenticator resolves a raw key to an org slug.
type Authenticator interface {
	Authenticate(ctx context.Context, rawKey string) (string, error)
}

// Server holds handler dependencies.
type Server struct {
	auth    Authenticator
	buffer  Enqueuer
	dedup   *dedup.Set
	metrics *metrics.Metrics
	log     *slog.Logger

	chPing Pinger
	pgPing Pinger

	maxBatch int // max events accepted in a single request
}

// Config configures a Server.
type Config struct {
	Auth          Authenticator
	Buffer        Enqueuer
	Dedup         *dedup.Set
	Metrics       *metrics.Metrics
	Log           *slog.Logger
	ClickHouse    Pinger
	Postgres      Pinger
	MaxBatchEvents int
}

// New builds the Server.
func New(cfg Config) *Server {
	mb := cfg.MaxBatchEvents
	if mb <= 0 {
		mb = 10000
	}
	return &Server{
		auth:     cfg.Auth,
		buffer:   cfg.Buffer,
		dedup:    cfg.Dedup,
		metrics:  cfg.Metrics,
		log:      cfg.Log,
		chPing:   cfg.ClickHouse,
		pgPing:   cfg.Postgres,
		maxBatch: mb,
	}
}

// Handler returns the routed, middleware-wrapped http.Handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/events", s.handleEvents)
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.Handle("GET /metrics", promhttp.HandlerFor(s.metrics.Registry, promhttp.HandlerOpts{}))

	return s.recoverMW(s.logMW(mux))
}

type eventsRequest struct {
	Events []model.Event `json:"events"`
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	rawKey := bearerToken(r)
	if rawKey == "" {
		s.metrics.AuthFailures.Inc()
		writeJSONError(w, http.StatusUnauthorized, "missing or malformed Authorization header")
		return
	}
	orgSlug, err := s.auth.Authenticate(r.Context(), rawKey)
	if err != nil {
		s.metrics.AuthFailures.Inc()
		writeJSONError(w, http.StatusUnauthorized, "invalid api key")
		return
	}

	var req eventsRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<20)) // 16 MiB cap
	dec.UseNumber()
	if err := dec.Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "malformed JSON body")
		return
	}
	if len(req.Events) == 0 {
		writeJSONError(w, http.StatusBadRequest, "events array is empty")
		return
	}
	if len(req.Events) > s.maxBatch {
		writeJSONError(w, http.StatusBadRequest, "batch too large")
		return
	}

	s.metrics.EventsReceived.Add(float64(len(req.Events)))

	// Validate, stamp org_id, dedup.
	accepted := make([]model.Event, 0, len(req.Events))
	for i := range req.Events {
		e := req.Events[i]
		if err := e.Validate(); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid event: "+err.Error())
			return
		}
		e.OrgID = orgSlug // ignore any client-supplied org_id
		if s.dedup.Seen(e.RequestID) {
			s.metrics.EventsDropped.Inc()
			continue
		}
		accepted = append(accepted, e)
	}

	if len(accepted) == 0 {
		// All were duplicates — still a successful enqueue from client's view.
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{"accepted": 0, "duplicates": len(req.Events)})
		return
	}

	if _, full := s.buffer.Add(accepted); full {
		s.metrics.EventsDropped.Add(float64(len(accepted)))
		w.Header().Set("Retry-After", "1")
		writeJSONError(w, http.StatusTooManyRequests, "buffer full, retry later")
		return
	}

	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"accepted":   len(accepted),
		"duplicates": len(req.Events) - len(accepted),
	})
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if s.chPing != nil {
		if err := s.chPing.Ping(ctx); err != nil {
			writeJSONError(w, http.StatusServiceUnavailable, "clickhouse unreachable")
			return
		}
	}
	if s.pgPing != nil {
		if err := s.pgPing.Ping(ctx); err != nil {
			writeJSONError(w, http.StatusServiceUnavailable, "postgres unreachable")
			return
		}
	}
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	const p = "Bearer "
	if len(h) > len(p) && strings.EqualFold(h[:len(p)], p) {
		return strings.TrimSpace(h[len(p):])
	}
	return ""
}

func writeJSONError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
