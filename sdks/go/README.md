# CostObs Go SDK

Drop-in AI/LLM cost observability for Go services. Works with **any provider
SDK built on `net/http`** (openai-go, anthropic-sdk-go, raw HTTP) via an
observing `http.RoundTripper` — no proxying of your traffic, no prompt or
response content ever recorded.

```go
import (
    "net/http"

    costobs "github.com/officialasishkumar/costobs/sdks/go"
    "github.com/openai/openai-go"
    "github.com/openai/openai-go/option"
)

co := costobs.New(costobs.Config{
    IngestURL: "http://localhost:8080",
    APIKey:    "costobs_dev_secret_key",
    Team:      "payments", Environment: "prod",
})
defer co.Close()

httpClient := &http.Client{Transport: co.Transport(nil)}
oai := openai.NewClient(option.WithHTTPClient(httpClient))

ctx := costobs.WithMetadata(ctx, costobs.Metadata{
    CustomerID: "cust-42",
    Feature:    "chat",
    Tags:       map[string]string{"pr": "1234"},
})
resp, err := oai.Chat.Completions.New(ctx, ...)
```

## What gets observed

- **Providers detected by host**: OpenAI, Anthropic, Gemini, and every
  OpenAI-compatible API (xAI, Together, Fireworks, OpenRouter, Groq,
  DeepSeek, Mistral, Azure). Unknown hosts pass through untouched.
- **JSON responses**: usage parsed (tokens, cached, reasoning), priced
  locally from the bundled pricing file with exact decimal math.
- **SSE streams**: the body is teed; usage is read from the final chunks
  (OpenAI `include_usage`, Anthropic `message_start`/`message_delta`) and the
  event fires when the caller finishes or closes the stream.
- **Failures**: non-2xx responses and transport errors record error events.

## Manual recording

For anything the transport can't see (gRPC providers, batch jobs, audio):

```go
co.Record(ctx, costobs.RecordOptions{
    Provider: "elevenlabs", Model: "eleven_multilingual_v2",
    Operation: "audio",
    Usage:     costobs.Usage{Characters: len(text)},
})
```

## Lifecycle

Shipping is asynchronous on a background goroutine; the hot path is a
non-blocking channel send (full buffer drops, never blocks). Call
`co.Flush(ctx)` before short-lived programs exit, `co.Close()` on shutdown.
