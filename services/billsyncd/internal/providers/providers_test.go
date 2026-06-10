package providers

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestOpenAIFetchDailyPaginatesAndBucketsByDay(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer admin-key" {
			t.Errorf("missing admin auth header, got %q", got)
		}
		if r.URL.Path != "/v1/organization/costs" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		calls++
		if r.URL.Query().Get("page") == "" {
			fmt.Fprint(w, `{
			  "data": [
			    {"start_time": 1767225600, "results": [
			      {"amount": {"value": 1.25, "currency": "usd"}},
			      {"amount": {"value": 0.75, "currency": "usd"}}
			    ]}
			  ],
			  "has_more": true, "next_page": "p2"
			}`)
			return
		}
		fmt.Fprint(w, `{
		  "data": [
		    {"start_time": 1767312000, "results": [
		      {"amount": {"value": 3.5, "currency": "usd"}}
		    ]}
		  ],
		  "has_more": false, "next_page": null
		}`)
	}))
	defer srv.Close()

	f := NewOpenAI(srv.URL, "admin-key")
	from := time.Unix(1767225600, 0).UTC() // 2026-01-01
	daily, err := f.FetchDaily(context.Background(), from, from.AddDate(0, 0, 2))
	if err != nil {
		t.Fatalf("FetchDaily: %v", err)
	}
	if calls != 2 {
		t.Fatalf("expected 2 paginated calls, got %d", calls)
	}
	if len(daily) != 2 {
		t.Fatalf("expected 2 days, got %d: %+v", len(daily), daily)
	}
	if daily[0].USD.String() != "2" {
		t.Errorf("day1: want 2, got %s", daily[0].USD)
	}
	if daily[1].USD.String() != "3.5" {
		t.Errorf("day2: want 3.5, got %s", daily[1].USD)
	}
	if !daily[0].Date.Before(daily[1].Date) {
		t.Errorf("days not sorted: %+v", daily)
	}
}

func TestAnthropicFetchDailyParsesStringAmounts(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("x-api-key"); got != "admin-key" {
			t.Errorf("missing x-api-key header, got %q", got)
		}
		if got := r.Header.Get("anthropic-version"); got == "" {
			t.Error("missing anthropic-version header")
		}
		fmt.Fprint(w, `{
		  "data": [
		    {"starting_at": "2026-01-01T00:00:00Z", "results": [
		      {"amount": "12.34", "currency": "USD"},
		      {"amount": "0.66", "currency": "USD"}
		    ]}
		  ],
		  "has_more": false, "next_page": null
		}`)
	}))
	defer srv.Close()

	f := NewAnthropic(srv.URL, "admin-key")
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	daily, err := f.FetchDaily(context.Background(), from, from.AddDate(0, 0, 1))
	if err != nil {
		t.Fatalf("FetchDaily: %v", err)
	}
	if len(daily) != 1 {
		t.Fatalf("expected 1 day, got %d", len(daily))
	}
	if daily[0].USD.String() != "13" {
		t.Errorf("want 13, got %s", daily[0].USD)
	}
}

func TestFetchDailySurfacesHTTPErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"insufficient permissions"}`, http.StatusForbidden)
	}))
	defer srv.Close()

	f := NewOpenAI(srv.URL, "bad-key")
	_, err := f.FetchDaily(context.Background(), time.Now().AddDate(0, 0, -1), time.Now())
	if err == nil {
		t.Fatal("expected error on 403, got nil")
	}
}
