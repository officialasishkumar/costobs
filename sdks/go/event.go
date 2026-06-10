package costobs

import (
	"crypto/rand"
	"time"
)

// SDKVersion is stamped onto every event.
const SDKVersion = "0.1.0"

const sdkLang = "go"

// Event is the wire contract between SDKs and the ingest service. Field names
// map 1:1 to shared/proto/event.schema.json. No prompt/response bodies are
// ever carried here — token counts and metadata only.
type Event struct {
	RequestID string `json:"request_id"`
	TS        string `json:"ts"`

	Provider  string `json:"provider"`
	Model     string `json:"model"`
	Operation string `json:"operation"`
	Stream    bool   `json:"stream"`
	Status    string `json:"status"`
	ErrorType string `json:"error_type"`

	Environment   string            `json:"environment"`
	Team          string            `json:"team"`
	Service       string            `json:"service"`
	CustomerID    string            `json:"customer_id"`
	UserID        string            `json:"user_id"`
	TraceID       string            `json:"trace_id"`
	Feature       string            `json:"feature"`
	PromptKey     string            `json:"prompt_key"`
	PromptVersion string            `json:"prompt_version"`
	Tags          map[string]string `json:"tags"`

	InputTokens       int     `json:"input_tokens"`
	CachedInputTokens int     `json:"cached_input_tokens"`
	OutputTokens      int     `json:"output_tokens"`
	ReasoningTokens   int     `json:"reasoning_tokens"`
	ToolTokens        int     `json:"tool_tokens"`
	TotalTokens       int     `json:"total_tokens"`
	AudioSeconds      float64 `json:"audio_seconds"`
	Characters        int     `json:"characters"`
	ImageCount        int     `json:"image_count"`
	ImageTiles        int     `json:"image_tiles"`

	CostUSD        float64 `json:"cost_usd"`
	PricingVersion string  `json:"pricing_version"`

	LatencyMs  int    `json:"latency_ms"`
	SDKLang    string `json:"sdk_lang"`
	SDKVersion string `json:"sdk_version"`
}

// Usage is the normalized, provider-agnostic usage container.
type Usage struct {
	InputTokens       int
	CachedInputTokens int
	OutputTokens      int
	ReasoningTokens   int
	ToolTokens        int
	TotalTokens       int
	AudioSeconds      float64
	Characters        int
	ImageCount        int
	ImageTiles        int
}

func (u Usage) totalOrDerived() int {
	if u.TotalTokens != 0 {
		return u.TotalTokens
	}
	return u.InputTokens + u.OutputTokens + u.ReasoningTokens
}

const ulidEnc = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// newRequestID generates a client-side ULID (Crockford base32, 26 chars,
// time-sortable) matching the Python/TS SDKs.
func newRequestID() string {
	tsMs := uint64(time.Now().UnixMilli())
	var rnd [10]byte
	_, _ = rand.Read(rnd[:])

	out := make([]byte, 26)
	// 48-bit timestamp into the first 10 chars.
	v := tsMs
	for i := 9; i >= 0; i-- {
		out[i] = ulidEnc[v%32]
		v /= 32
	}
	// 80 bits of randomness into the remaining 16 chars (5 bits each).
	var bitBuf uint32
	bits := 0
	pos := 10
	for _, b := range rnd {
		bitBuf = bitBuf<<8 | uint32(b)
		bits += 8
		for bits >= 5 {
			bits -= 5
			out[pos] = ulidEnc[(bitBuf>>bits)&0x1f]
			pos++
		}
	}
	return string(out)
}

func utcNowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}
