package model

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/shopspring/decimal"
)

// Event is the wire contract between SDKs and the ingest service. Field names
// map 1:1 to the ClickHouse `events` columns. JSON tags match
// shared/proto/event.schema.json. No prompt/response bodies are ever stored.
type Event struct {
	RequestID string    `json:"request_id"`
	TS        time.Time `json:"ts"`

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

	InputTokens       uint32  `json:"input_tokens"`
	CachedInputTokens uint32  `json:"cached_input_tokens"`
	OutputTokens      uint32  `json:"output_tokens"`
	ReasoningTokens   uint32  `json:"reasoning_tokens"`
	ToolTokens        uint32  `json:"tool_tokens"`
	TotalTokens       uint32  `json:"total_tokens"`
	AudioSeconds      float32 `json:"audio_seconds"`
	ImageCount        uint16  `json:"image_count"`
	ImageTiles        uint32  `json:"image_tiles"`

	// CostUsd is read from a JSON number as a decimal string to avoid float
	// drift; it maps to ClickHouse Decimal(18,10).
	CostUsd        decimal.Decimal `json:"-"`
	PricingVersion string          `json:"pricing_version"`

	LatencyMs  uint32 `json:"latency_ms"`
	SDKLang    string `json:"sdk_lang"`
	SDKVersion string `json:"sdk_version"`

	// OrgID is server-stamped (the org slug). Any client-supplied value is
	// ignored — it is not part of the wire schema.
	OrgID string `json:"-"`
}

// eventAlias mirrors Event but reads cost_usd as a json.Number so we can
// convert without float drift, and drops org_id from the wire entirely.
type eventAlias struct {
	RequestID string    `json:"request_id"`
	TS        time.Time `json:"ts"`

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

	InputTokens       uint32  `json:"input_tokens"`
	CachedInputTokens uint32  `json:"cached_input_tokens"`
	OutputTokens      uint32  `json:"output_tokens"`
	ReasoningTokens   uint32  `json:"reasoning_tokens"`
	ToolTokens        uint32  `json:"tool_tokens"`
	TotalTokens       uint32  `json:"total_tokens"`
	AudioSeconds      float32 `json:"audio_seconds"`
	ImageCount        uint16  `json:"image_count"`
	ImageTiles        uint32  `json:"image_tiles"`

	CostUsd        json.Number `json:"cost_usd"`
	PricingVersion string      `json:"pricing_version"`

	LatencyMs  uint32 `json:"latency_ms"`
	SDKLang    string `json:"sdk_lang"`
	SDKVersion string `json:"sdk_version"`
}

// UnmarshalJSON decodes the wire format, converting cost_usd from a JSON
// number to a shopspring decimal (avoiding float64 precision loss).
func (e *Event) UnmarshalJSON(data []byte) error {
	var a eventAlias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}

	e.RequestID = a.RequestID
	e.TS = a.TS
	e.Provider = a.Provider
	e.Model = a.Model
	e.Operation = a.Operation
	e.Stream = a.Stream
	e.Status = a.Status
	e.ErrorType = a.ErrorType
	e.Environment = a.Environment
	e.Team = a.Team
	e.Service = a.Service
	e.CustomerID = a.CustomerID
	e.UserID = a.UserID
	e.TraceID = a.TraceID
	e.Feature = a.Feature
	e.PromptKey = a.PromptKey
	e.PromptVersion = a.PromptVersion
	e.Tags = a.Tags
	e.InputTokens = a.InputTokens
	e.CachedInputTokens = a.CachedInputTokens
	e.OutputTokens = a.OutputTokens
	e.ReasoningTokens = a.ReasoningTokens
	e.ToolTokens = a.ToolTokens
	e.TotalTokens = a.TotalTokens
	e.AudioSeconds = a.AudioSeconds
	e.ImageCount = a.ImageCount
	e.ImageTiles = a.ImageTiles
	e.PricingVersion = a.PricingVersion
	e.LatencyMs = a.LatencyMs
	e.SDKLang = a.SDKLang
	e.SDKVersion = a.SDKVersion

	if s := string(a.CostUsd); s != "" {
		d, err := decimal.NewFromString(s)
		if err != nil {
			return fmt.Errorf("invalid cost_usd %q: %w", s, err)
		}
		e.CostUsd = d
	} else {
		e.CostUsd = decimal.Zero
	}

	if e.Tags == nil {
		e.Tags = map[string]string{}
	}
	return nil
}

// Validate checks the schema-required fields are present.
func (e *Event) Validate() error {
	switch {
	case e.RequestID == "":
		return fmt.Errorf("request_id is required")
	case e.TS.IsZero():
		return fmt.Errorf("ts is required")
	case e.Provider == "":
		return fmt.Errorf("provider is required")
	case e.Model == "":
		return fmt.Errorf("model is required")
	case e.Operation == "":
		return fmt.Errorf("operation is required")
	case e.Status == "":
		return fmt.Errorf("status is required")
	case e.PricingVersion == "":
		return fmt.Errorf("pricing_version is required")
	case e.SDKLang == "":
		return fmt.Errorf("sdk_lang is required")
	case e.SDKVersion == "":
		return fmt.Errorf("sdk_version is required")
	}
	return nil
}
