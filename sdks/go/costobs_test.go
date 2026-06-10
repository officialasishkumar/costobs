package costobs

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeIngest captures batches POSTed to /v1/events.
type fakeIngest struct {
	mu     sync.Mutex
	events []Event
	auth   string
	srv    *httptest.Server
}

func newFakeIngest(t *testing.T) *fakeIngest {
	t.Helper()
	f := &fakeIngest{}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/events" {
			http.NotFound(w, r)
			return
		}
		var payload struct {
			Events []Event `json:"events"`
		}
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, &payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		f.mu.Lock()
		f.events = append(f.events, payload.Events...)
		f.auth = r.Header.Get("Authorization")
		f.mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeIngest) drain(t *testing.T, c *Client, want int) []Event {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		f.mu.Lock()
		n := len(f.events)
		f.mu.Unlock()
		if n >= want {
			break
		}
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		c.Flush(ctx)
		cancel()
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Event(nil), f.events...)
}

func newTestClient(t *testing.T, f *fakeIngest) *Client {
	t.Helper()
	c := New(Config{
		IngestURL:     f.srv.URL,
		APIKey:        "test-key",
		Team:          "ml",
		Environment:   "test",
		BatchSize:     1,
		FlushInterval: 20 * time.Millisecond,
	})
	t.Cleanup(c.Close)
	return c
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

func TestPricingKnownAndUnknownModels(t *testing.T) {
	eng := DefaultPricing()
	if eng.Version == "" || eng.Version == "invalid" {
		t.Fatalf("embedded pricing failed to load: version=%q", eng.Version)
	}

	cost := eng.Cost(Usage{InputTokens: 1000, OutputTokens: 100}, "openai", "gpt-4o")
	want := 1000*0.0000025 + 100*0.00001
	if got, _ := cost.Float64(); got < want*0.999 || got > want*1.001 {
		t.Errorf("gpt-4o cost = %v, want ~%v", got, want)
	}

	if !eng.Cost(Usage{InputTokens: 1000}, "nope", "unknown-model").IsZero() {
		t.Error("unknown model should cost 0")
	}

	tts := eng.Cost(Usage{Characters: 1000}, "elevenlabs", "eleven_multilingual_v2")
	if got, _ := tts.Float64(); got < 0.299 || got > 0.301 {
		t.Errorf("TTS characters cost = %v, want 0.3", got)
	}
}

// ---------------------------------------------------------------------------
// Record + metadata layering
// ---------------------------------------------------------------------------

func TestRecordMergesContextMetadata(t *testing.T) {
	f := newFakeIngest(t)
	c := newTestClient(t, f)

	ctx := WithMetadata(context.Background(), Metadata{
		CustomerID: "cust-42",
		Tags:       map[string]string{"pr": "1234"},
	})
	ctx = WithMetadata(ctx, Metadata{Feature: "chat"}) // nested merge

	c.Record(ctx, RecordOptions{
		Provider: "openai", Model: "gpt-4o",
		Usage: Usage{InputTokens: 100, OutputTokens: 10},
	})

	events := f.drain(t, c, 1)
	if len(events) != 1 {
		t.Fatalf("want 1 event, got %d", len(events))
	}
	ev := events[0]
	if ev.Team != "ml" || ev.Environment != "test" {
		t.Errorf("client defaults missing: %+v", ev)
	}
	if ev.CustomerID != "cust-42" || ev.Feature != "chat" || ev.Tags["pr"] != "1234" {
		t.Errorf("context metadata missing: %+v", ev)
	}
	if ev.CostUSD <= 0 || ev.TotalTokens != 110 {
		t.Errorf("pricing/usage wrong: cost=%v total=%d", ev.CostUSD, ev.TotalTokens)
	}
	if ev.SDKLang != "go" || len(ev.RequestID) != 26 {
		t.Errorf("sdk stamp wrong: %+v", ev)
	}
}

// ---------------------------------------------------------------------------
// Transport: JSON responses
// ---------------------------------------------------------------------------

// hostRewriteTransport routes every request to the fake provider server while
// preserving the original Host for provider detection.
type hostRewriteTransport struct {
	target string
	inner  http.RoundTripper
}

func (h *hostRewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req.URL.Scheme = "http"
	req.URL.Host = strings.TrimPrefix(h.target, "http://")
	return h.inner.RoundTrip(req)
}

func TestTransportObservesOpenAIChatJSON(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{
		  "model": "gpt-4o-2024-11-20",
		  "choices": [{"message": {"role": "assistant", "content": "hi"}}],
		  "usage": {
		    "prompt_tokens": 120, "completion_tokens": 30, "total_tokens": 150,
		    "prompt_tokens_details": {"cached_tokens": 20},
		    "completion_tokens_details": {"reasoning_tokens": 5}
		  }
		}`)
	}))
	defer provider.Close()

	f := newFakeIngest(t)
	c := newTestClient(t, f)
	httpClient := &http.Client{
		Transport: c.Transport(&hostRewriteTransport{target: provider.URL, inner: http.DefaultTransport}),
	}

	ctx := WithMetadata(context.Background(), Metadata{Feature: "summarize"})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.openai.com/v1/chat/completions", strings.NewReader(`{"model":"gpt-4o"}`))
	resp, err := httpClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !strings.Contains(string(body), `"hi"`) {
		t.Fatalf("caller must receive the untouched body, got %s", body)
	}

	events := f.drain(t, c, 1)
	if len(events) != 1 {
		t.Fatalf("want 1 event, got %d", len(events))
	}
	ev := events[0]
	if ev.Provider != "openai" || ev.Model != "gpt-4o-2024-11-20" || ev.Operation != "chat" {
		t.Errorf("identity wrong: %+v", ev)
	}
	if ev.InputTokens != 100 || ev.CachedInputTokens != 20 || ev.OutputTokens != 30 || ev.ReasoningTokens != 5 {
		t.Errorf("usage wrong: %+v", ev)
	}
	if ev.Feature != "summarize" || ev.CostUSD <= 0 {
		t.Errorf("metadata/cost wrong: %+v", ev)
	}
}

func TestTransportObservesAnthropicJSONAndErrors(t *testing.T) {
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		if calls == 1 {
			fmt.Fprint(w, `{
			  "model": "claude-sonnet-4-6",
			  "usage": {"input_tokens": 80, "output_tokens": 40,
			            "cache_read_input_tokens": 10, "cache_creation_input_tokens": 5}
			}`)
			return
		}
		w.WriteHeader(http.StatusTooManyRequests)
		fmt.Fprint(w, `{"error": {"type": "rate_limit_error"}}`)
	}))
	defer provider.Close()

	f := newFakeIngest(t)
	c := newTestClient(t, f)
	httpClient := &http.Client{
		Transport: c.Transport(&hostRewriteTransport{target: provider.URL, inner: http.DefaultTransport}),
	}

	for i := 0; i < 2; i++ {
		req, _ := http.NewRequest(http.MethodPost,
			"https://api.anthropic.com/v1/messages", strings.NewReader(`{}`))
		resp, err := httpClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}

	events := f.drain(t, c, 2)
	if len(events) != 2 {
		t.Fatalf("want 2 events, got %d", len(events))
	}
	ok := events[0]
	if ok.Provider != "anthropic" || ok.InputTokens != 85 || ok.CachedInputTokens != 10 || ok.OutputTokens != 40 {
		t.Errorf("anthropic usage wrong (cache write should fold into input): %+v", ok)
	}
	errEv := events[1]
	if errEv.Status != "error" || errEv.ErrorType == "" {
		t.Errorf("429 should record an error event: %+v", errEv)
	}
}

// ---------------------------------------------------------------------------
// Transport: SSE streaming
// ---------------------------------------------------------------------------

func TestTransportObservesOpenAIStream(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"model\":\"gpt-4o\",\"choices\":[{\"delta\":{\"content\":\"he\"}}],\"usage\":null}\n\n")
		fmt.Fprint(w, "data: {\"model\":\"gpt-4o\",\"choices\":[{\"delta\":{\"content\":\"llo\"}}],\"usage\":null}\n\n")
		fmt.Fprint(w, "data: {\"model\":\"gpt-4o\",\"choices\":[],\"usage\":{\"prompt_tokens\":50,\"completion_tokens\":12,\"total_tokens\":62}}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer provider.Close()

	f := newFakeIngest(t)
	c := newTestClient(t, f)
	httpClient := &http.Client{
		Transport: c.Transport(&hostRewriteTransport{target: provider.URL, inner: http.DefaultTransport}),
	}

	req, _ := http.NewRequest(http.MethodPost,
		"https://api.openai.com/v1/chat/completions", strings.NewReader(`{"stream":true}`))
	resp, err := httpClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	streamed, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !strings.Contains(string(streamed), "[DONE]") {
		t.Fatalf("stream must pass through untouched, got: %s", streamed)
	}

	events := f.drain(t, c, 1)
	if len(events) != 1 {
		t.Fatalf("want 1 event, got %d", len(events))
	}
	ev := events[0]
	if !ev.Stream || ev.InputTokens != 50 || ev.OutputTokens != 12 || ev.TotalTokens != 62 {
		t.Errorf("streamed usage wrong: %+v", ev)
	}
}

func TestTransportObservesAnthropicStream(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "event: message_start\n")
		fmt.Fprint(w, "data: {\"type\":\"message_start\",\"message\":{\"model\":\"claude-sonnet-4-6\",\"usage\":{\"input_tokens\":100,\"cache_read_input_tokens\":10}}}\n\n")
		fmt.Fprint(w, "event: message_delta\n")
		fmt.Fprint(w, "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":25}}\n\n")
	}))
	defer provider.Close()

	f := newFakeIngest(t)
	c := newTestClient(t, f)
	httpClient := &http.Client{
		Transport: c.Transport(&hostRewriteTransport{target: provider.URL, inner: http.DefaultTransport}),
	}

	req, _ := http.NewRequest(http.MethodPost,
		"https://api.anthropic.com/v1/messages", strings.NewReader(`{"stream":true}`))
	resp, err := httpClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()

	events := f.drain(t, c, 1)
	ev := events[0]
	if ev.Model != "claude-sonnet-4-6" || ev.InputTokens != 100 || ev.CachedInputTokens != 10 || ev.OutputTokens != 25 {
		t.Errorf("anthropic streamed usage wrong: %+v", ev)
	}
}

// ---------------------------------------------------------------------------
// Pass-through behavior
// ---------------------------------------------------------------------------

func TestTransportIgnoresUnknownHostsAndGETs(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"ok": true}`)
	}))
	defer provider.Close()

	f := newFakeIngest(t)
	c := newTestClient(t, f)
	httpClient := &http.Client{Transport: c.Transport(nil)}

	resp, err := httpClient.Post(provider.URL+"/anything", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	time.Sleep(100 * time.Millisecond)
	f.mu.Lock()
	n := len(f.events)
	f.mu.Unlock()
	if n != 0 {
		t.Fatalf("unknown host must not be observed, got %d events", n)
	}
}
