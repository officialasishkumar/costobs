// Package deliver formats and ships fired-alert notifications to webhook and
// Slack targets. Delivery is retried with bounded backoff; persistent failures
// are returned to the caller (which logs and increments a metric) but never
// panic or block other targets.
package deliver

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

// Payload is the canonical fired-alert event shared by all target kinds.
type Payload struct {
	RuleID       int64             `json:"rule_id"`
	RuleName     string            `json:"rule_name"`
	OrgSlug      string            `json:"org_slug"`
	Kind         string            `json:"kind"`
	ObservedUSD  float64           `json:"observed_usd"`
	ThresholdUSD float64           `json:"threshold_usd"`
	Scope        map[string]string `json:"scope"`
	FiredAt      time.Time         `json:"fired_at"`
}

// Target is the minimal view of a delivery target the dispatcher needs.
type Target struct {
	Kind   string // "webhook" | "slack"
	Config map[string]any
}

// Target kinds.
const (
	KindWebhook = "webhook"
	KindSlack   = "slack"
)

// Dispatcher delivers payloads to targets over HTTP.
type Dispatcher struct {
	client   *http.Client
	attempts int
	baseWait time.Duration
}

// New returns a Dispatcher. A nil client uses a sane default with timeout.
func New(client *http.Client) *Dispatcher {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &Dispatcher{client: client, attempts: 3, baseWait: 500 * time.Millisecond}
}

// configString returns the string value at key, or "" if absent / not a string.
func configString(cfg map[string]any, key string) string {
	if v, ok := cfg[key].(string); ok {
		return v
	}
	return ""
}

// Deliver dispatches the payload to a single target based on its kind. It
// returns an error only after exhausting retries.
func (d *Dispatcher) Deliver(ctx context.Context, t Target, p Payload) error {
	switch t.Kind {
	case KindWebhook:
		return d.deliverWebhook(ctx, t.Config, p)
	case KindSlack:
		return d.deliverSlack(ctx, t.Config, p)
	default:
		return fmt.Errorf("unknown target kind %q", t.Kind)
	}
}

// post sends body to url with the given content type and extra headers, with
// bounded exponential backoff. A 2xx response is success; non-2xx and transport
// errors are retried.
func (d *Dispatcher) post(ctx context.Context, url, contentType string, body []byte, headers map[string]string) error {
	var lastErr error
	wait := d.baseWait
	for attempt := 0; attempt < d.attempts; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(wait):
			}
			wait *= 2
			if wait > 5*time.Second {
				wait = 5 * time.Second
			}
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, newReader(body))
		if err != nil {
			return fmt.Errorf("build request: %w", err) // not retryable
		}
		req.Header.Set("Content-Type", contentType)
		for k, v := range headers {
			req.Header.Set(k, v)
		}

		resp, err := d.client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		drainAndClose(resp)
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return nil
		}
		lastErr = fmt.Errorf("non-2xx response: %s", resp.Status)
	}
	return fmt.Errorf("delivery failed after %d attempts: %w", d.attempts, lastErr)
}
