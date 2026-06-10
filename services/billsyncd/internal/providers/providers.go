// Package providers implements billing/cost fetchers for provider admin APIs.
//
// Each fetcher returns the actual billed (or provider-metered) cost per UTC
// day, which billsyncd persists into ClickHouse `billed_daily` for the
// dashboard's reconciliation view (tracked SDK estimates vs. real bills).
package providers

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/shopspring/decimal"
)

// DailyCost is one provider/day of billed spend.
type DailyCost struct {
	Date time.Time // UTC midnight
	USD  decimal.Decimal
}

// Fetcher pulls billed daily cost from one provider's admin API.
type Fetcher interface {
	// Name is the provider name as stamped on events ("openai", "anthropic").
	Name() string
	// FetchDaily returns billed cost per UTC day within [from, to].
	FetchDaily(ctx context.Context, from, to time.Time) ([]DailyCost, error)
}

// httpGetJSON issues a GET and returns the body, failing on non-2xx statuses.
func httpGetJSON(ctx context.Context, client *http.Client, url string, headers map[string]string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%s: status %d: %.200s", url, resp.StatusCode, string(body))
	}
	return body, nil
}

func dayUTC(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}
