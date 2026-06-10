package costobs

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

// hostProviders maps API hosts (substring match) to provider names.
var hostProviders = []struct{ host, provider string }{
	{"api.openai.com", "openai"},
	{"api.anthropic.com", "anthropic"},
	{"generativelanguage.googleapis.com", "gemini"},
	{"api.x.ai", "xai"},
	{"api.together.xyz", "together"},
	{"api.fireworks.ai", "fireworks"},
	{"openrouter.ai", "openrouter"},
	{"api.groq.com", "groq"},
	{"api.deepseek.com", "deepseek"},
	{"api.mistral.ai", "mistral"},
	{"openai.azure.com", "azure-openai"},
}

func providerForHost(host string) string {
	for _, hp := range hostProviders {
		if strings.Contains(host, hp.host) {
			return hp.provider
		}
	}
	return ""
}

func operationForPath(path string) string {
	switch {
	case strings.Contains(path, "/embeddings"):
		return "embedding"
	case strings.Contains(path, "/responses"):
		return "responses"
	default:
		return "chat"
	}
}

// Transport returns an http.RoundTripper that observes provider API calls
// flowing through it. Pass nil to wrap http.DefaultTransport. Unrecognized
// hosts pass through untouched, so one client can front everything.
func (c *Client) Transport(base http.RoundTripper) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	return &observingTransport{client: c, base: base}
}

type observingTransport struct {
	client *Client
	base   http.RoundTripper
}

func (t *observingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	provider := providerForHost(req.URL.Host)
	if provider == "" || req.Method != http.MethodPost {
		return t.base.RoundTrip(req)
	}

	start := time.Now()
	meta := MetadataFrom(req.Context())
	operation := operationForPath(req.URL.Path)

	resp, err := t.base.RoundTrip(req)
	latency := int(time.Since(start).Milliseconds())

	if err != nil {
		t.client.Record(req.Context(), RecordOptions{
			Provider: provider, Model: "", Operation: operation,
			Status: "error", ErrorType: "TransportError",
			LatencyMs: latency, Metadata: meta, ForceCost: true,
		})
		return resp, err
	}

	ct := resp.Header.Get("Content-Type")
	switch {
	case strings.Contains(ct, "text/event-stream"):
		// Tee the SSE stream; usage arrives in the final chunks. The event is
		// emitted when the caller finishes (EOF) or closes the body.
		resp.Body = newSSEBody(resp.Body, func(u Usage, model string) {
			t.client.Record(req.Context(), RecordOptions{
				Provider: provider, Model: model, Operation: operation,
				Status: statusFor(resp.StatusCode), ErrorType: errorTypeFor(resp.StatusCode),
				Stream: true, LatencyMs: int(time.Since(start).Milliseconds()),
				Usage: u, Metadata: meta,
			})
		})
	case strings.Contains(ct, "application/json"):
		// Buffer the body (provider responses are small), parse usage, and
		// hand the caller an identical replacement reader.
		body, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		resp.Body = io.NopCloser(bytes.NewReader(body))
		if readErr == nil {
			u, model := parseUsageJSON(body)
			t.client.Record(req.Context(), RecordOptions{
				Provider: provider, Model: model, Operation: operation,
				Status: statusFor(resp.StatusCode), ErrorType: errorTypeFor(resp.StatusCode),
				LatencyMs: latency, Usage: u, Metadata: meta,
			})
		}
	}
	return resp, nil
}

func statusFor(code int) string {
	if code >= 200 && code < 300 {
		return "ok"
	}
	return "error"
}

func errorTypeFor(code int) string {
	if code >= 200 && code < 300 {
		return ""
	}
	return http.StatusText(code)
}

// wireUsage covers OpenAI (chat + responses), OpenAI-compatible, Anthropic,
// and Gemini usage shapes in one struct.
type wireUsage struct {
	// OpenAI chat
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
	PromptDetails    struct {
		CachedTokens int `json:"cached_tokens"`
	} `json:"prompt_tokens_details"`
	CompletionDetails struct {
		ReasoningTokens int `json:"reasoning_tokens"`
	} `json:"completion_tokens_details"`
	// OpenAI responses / Anthropic
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
	InputDetails struct {
		CachedTokens int `json:"cached_tokens"`
	} `json:"input_tokens_details"`
	OutputDetails struct {
		ReasoningTokens int `json:"reasoning_tokens"`
	} `json:"output_tokens_details"`
	// Anthropic cache fields
	CacheReadInputTokens     int `json:"cache_read_input_tokens"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
}

func (w wireUsage) toUsage() Usage {
	input := w.PromptTokens
	if input == 0 {
		input = w.InputTokens
	}
	output := w.CompletionTokens
	if output == 0 {
		output = w.OutputTokens
	}
	cached := w.PromptDetails.CachedTokens
	if cached == 0 {
		cached = w.InputDetails.CachedTokens
	}
	if cached == 0 {
		cached = w.CacheReadInputTokens
	}
	reasoning := w.CompletionDetails.ReasoningTokens
	if reasoning == 0 {
		reasoning = w.OutputDetails.ReasoningTokens
	}
	// Anthropic: input excludes cache reads; cache writes bill as input.
	// OpenAI: prompt_tokens INCLUDES cached — subtract to avoid double count.
	nonCached := input
	if w.PromptTokens > 0 || w.InputDetails.CachedTokens > 0 {
		if nonCached >= cached {
			nonCached = input - cached
		}
	}
	nonCached += w.CacheCreationInputTokens
	return Usage{
		InputTokens:       nonCached,
		CachedInputTokens: cached,
		OutputTokens:      output,
		ReasoningTokens:   reasoning,
		TotalTokens:       w.TotalTokens,
	}
}

type wireResponse struct {
	Model string    `json:"model"`
	Usage wireUsage `json:"usage"`
	// Gemini
	ModelVersion  string `json:"modelVersion"`
	UsageMetadata struct {
		PromptTokenCount        int `json:"promptTokenCount"`
		CandidatesTokenCount    int `json:"candidatesTokenCount"`
		CachedContentTokenCount int `json:"cachedContentTokenCount"`
		ThoughtsTokenCount      int `json:"thoughtsTokenCount"`
		TotalTokenCount         int `json:"totalTokenCount"`
	} `json:"usageMetadata"`
}

func parseUsageJSON(body []byte) (Usage, string) {
	var wr wireResponse
	if err := json.Unmarshal(body, &wr); err != nil {
		return Usage{}, ""
	}
	if wr.UsageMetadata.TotalTokenCount > 0 {
		m := wr.UsageMetadata
		return Usage{
			InputTokens:       maxInt(m.PromptTokenCount-m.CachedContentTokenCount, 0),
			CachedInputTokens: m.CachedContentTokenCount,
			OutputTokens:      m.CandidatesTokenCount,
			ReasoningTokens:   m.ThoughtsTokenCount,
			TotalTokens:       m.TotalTokenCount,
		}, firstNonEmpty(wr.ModelVersion, wr.Model)
	}
	return wr.Usage.toUsage(), wr.Model
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// sseBody tees a server-sent-event stream, accumulating usage from the data
// lines as they pass through, and fires onDone exactly once at EOF/Close.
type sseBody struct {
	inner io.ReadCloser
	buf   bytes.Buffer

	usage Usage
	model string

	onDone func(Usage, string)
	fired  bool
}

func newSSEBody(inner io.ReadCloser, onDone func(Usage, string)) io.ReadCloser {
	return &sseBody{inner: inner, onDone: onDone}
}

func (s *sseBody) Read(p []byte) (int, error) {
	n, err := s.inner.Read(p)
	if n > 0 {
		s.feed(p[:n])
	}
	if err == io.EOF {
		s.fire()
	}
	return n, err
}

func (s *sseBody) Close() error {
	s.fire()
	return s.inner.Close()
}

func (s *sseBody) fire() {
	if s.fired {
		return
	}
	s.fired = true
	s.onDone(s.usage, s.model)
}

// feed scans complete lines for `data: {...}` SSE payloads.
func (s *sseBody) feed(chunk []byte) {
	s.buf.Write(chunk)
	for {
		line, err := s.buf.ReadString('\n')
		if err != nil {
			// Partial line: keep it buffered for the next chunk.
			s.buf.Reset()
			s.buf.WriteString(line)
			return
		}
		s.parseLine(strings.TrimSpace(line))
	}
}

type sseChunk struct {
	Model string     `json:"model"`
	Usage *wireUsage `json:"usage"`
	// Anthropic stream events
	Type    string `json:"type"`
	Message struct {
		Model string     `json:"model"`
		Usage *wireUsage `json:"usage"`
	} `json:"message"`
}

func (s *sseBody) parseLine(line string) {
	if !strings.HasPrefix(line, "data:") {
		return
	}
	payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
	if payload == "" || payload == "[DONE]" {
		return
	}
	var c sseChunk
	if err := json.Unmarshal([]byte(payload), &c); err != nil {
		return
	}
	if c.Model != "" {
		s.model = c.Model
	}
	switch c.Type {
	case "message_start": // Anthropic: input usage rides the message
		if c.Message.Model != "" {
			s.model = c.Message.Model
		}
		if c.Message.Usage != nil {
			u := c.Message.Usage.toUsage()
			s.usage.InputTokens = u.InputTokens
			s.usage.CachedInputTokens = u.CachedInputTokens
			s.usage.ReasoningTokens = u.ReasoningTokens
		}
	case "message_delta": // Anthropic: cumulative output tokens
		if c.Usage != nil && c.Usage.OutputTokens > 0 {
			s.usage.OutputTokens = c.Usage.OutputTokens
		}
	default: // OpenAI-style: usage on the final chunk (include_usage)
		if c.Usage != nil {
			u := c.Usage.toUsage()
			if u.InputTokens+u.CachedInputTokens+u.OutputTokens > 0 {
				s.usage = u
			}
		}
	}
}
