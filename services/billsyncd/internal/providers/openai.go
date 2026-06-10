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

// OpenAI fetches daily billed cost from the OpenAI Costs API
// (GET /v1/organization/costs, requires an Admin API key).
type OpenAI struct {
	BaseURL string
	AdminKey string
	Client  *http.Client
}

// NewOpenAI builds an OpenAI fetcher.
func NewOpenAI(baseURL, adminKey string) *OpenAI {
	return &OpenAI{
		BaseURL:  baseURL,
		AdminKey: adminKey,
		Client:   &http.Client{Timeout: 30 * time.Second},
	}
}

// Name implements Fetcher.
func (o *OpenAI) Name() string { return "openai" }

type openaiCostsPage struct {
	Data []struct {
		StartTime int64 `json:"start_time"`
		Results   []struct {
			Amount struct {
				Value    json.Number `json:"value"`
				Currency string      `json:"currency"`
			} `json:"amount"`
		} `json:"results"`
	} `json:"data"`
	HasMore  bool   `json:"has_more"`
	NextPage string `json:"next_page"`
}

// FetchDaily implements Fetcher: 1-day cost buckets summed per UTC day.
func (o *OpenAI) FetchDaily(ctx context.Context, from, to time.Time) ([]DailyCost, error) {
	byDay := map[time.Time]decimal.Decimal{}
	page := ""
	for {
		q := url.Values{}
		q.Set("start_time", fmt.Sprintf("%d", dayUTC(from).Unix()))
		q.Set("end_time", fmt.Sprintf("%d", to.UTC().Unix()))
		q.Set("bucket_width", "1d")
		q.Set("limit", "180")
		if page != "" {
			q.Set("page", page)
		}
		body, err := httpGetJSON(ctx, o.Client, o.BaseURL+"/v1/organization/costs?"+q.Encode(), map[string]string{
			"Authorization": "Bearer " + o.AdminKey,
		})
		if err != nil {
			return nil, fmt.Errorf("openai costs: %w", err)
		}
		var p openaiCostsPage
		if err := json.Unmarshal(body, &p); err != nil {
			return nil, fmt.Errorf("openai costs: parse: %w", err)
		}
		for _, bucket := range p.Data {
			day := dayUTC(time.Unix(bucket.StartTime, 0))
			for _, r := range bucket.Results {
				amt, err := decimal.NewFromString(r.Amount.Value.String())
				if err != nil {
					return nil, fmt.Errorf("openai costs: bad amount %q: %w", r.Amount.Value, err)
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

func sortedDaily(byDay map[time.Time]decimal.Decimal) []DailyCost {
	out := make([]DailyCost, 0, len(byDay))
	for d, v := range byDay {
		out = append(out, DailyCost{Date: d, USD: v})
	}
	// Insertion sort by date (small N: bounded by lookback days).
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].Date.Before(out[j-1].Date); j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}
