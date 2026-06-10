package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/shopspring/decimal"
)

// Anthropic fetches daily billed cost from the Anthropic Cost API
// (GET /v1/organizations/cost_report, requires an Admin API key).
type Anthropic struct {
	BaseURL  string
	AdminKey string
	Client   *http.Client
}

// NewAnthropic builds an Anthropic fetcher.
func NewAnthropic(baseURL, adminKey string) *Anthropic {
	return &Anthropic{
		BaseURL:  baseURL,
		AdminKey: adminKey,
		Client:   &http.Client{Timeout: 30 * time.Second},
	}
}

// Name implements Fetcher.
func (a *Anthropic) Name() string { return "anthropic" }

type anthropicCostPage struct {
	Data []struct {
		StartingAt string `json:"starting_at"`
		Results    []struct {
			Amount   json.Number `json:"amount"`
			Currency string      `json:"currency"`
		} `json:"results"`
	} `json:"data"`
	HasMore  bool   `json:"has_more"`
	NextPage string `json:"next_page"`
}

// FetchDaily implements Fetcher: 1-day cost buckets summed per UTC day.
func (a *Anthropic) FetchDaily(ctx context.Context, from, to time.Time) ([]DailyCost, error) {
	byDay := map[time.Time]decimal.Decimal{}
	page := ""
	for {
		q := url.Values{}
		q.Set("starting_at", dayUTC(from).Format(time.RFC3339))
		q.Set("ending_at", to.UTC().Format(time.RFC3339))
		q.Set("bucket_width", "1d")
		if page != "" {
			q.Set("page", page)
		}
		body, err := httpGetJSON(ctx, a.Client, a.BaseURL+"/v1/organizations/cost_report?"+q.Encode(), map[string]string{
			"x-api-key":         a.AdminKey,
			"anthropic-version": "2023-06-01",
		})
		if err != nil {
			return nil, fmt.Errorf("anthropic cost_report: %w", err)
		}
		var p anthropicCostPage
		if err := json.Unmarshal(body, &p); err != nil {
			return nil, fmt.Errorf("anthropic cost_report: parse: %w", err)
		}
		for _, bucket := range p.Data {
			start, err := time.Parse(time.RFC3339, bucket.StartingAt)
			if err != nil {
				return nil, fmt.Errorf("anthropic cost_report: bad starting_at %q: %w", bucket.StartingAt, err)
			}
			day := dayUTC(start)
			for _, r := range bucket.Results {
				amt, err := decimal.NewFromString(r.Amount.String())
				if err != nil {
					return nil, fmt.Errorf("anthropic cost_report: bad amount %q: %w", r.Amount, err)
				}
				byDay[day] = byDay[day].Add(amt)
			}
		}
		if !p.HasMore || p.NextPage == "" {
			break
		}
		page = p.NextPage
	}
	return sortedDaily(byDay), nil
}
