package model

import (
	"encoding/json"
	"testing"
	"time"
)

func TestUnmarshalCostNoFloatDrift(t *testing.T) {
	const raw = `{
		"request_id":"r","ts":"2026-06-01T12:00:00Z","provider":"openai",
		"model":"gpt-4o","operation":"chat","status":"ok",
		"pricing_version":"v1","sdk_lang":"go","sdk_version":"1.0.0",
		"cost_usd": 0.1234567891
	}`
	var e Event
	if err := json.Unmarshal([]byte(raw), &e); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got := e.CostUsd.String(); got != "0.1234567891" {
		t.Fatalf("cost_usd = %q want 0.1234567891", got)
	}
}

func TestUnmarshalMissingCostDefaultsZero(t *testing.T) {
	const raw = `{
		"request_id":"r","ts":"2026-06-01T12:00:00Z","provider":"openai",
		"model":"gpt-4o","operation":"chat","status":"ok",
		"pricing_version":"v1","sdk_lang":"go","sdk_version":"1.0.0"
	}`
	var e Event
	if err := json.Unmarshal([]byte(raw), &e); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !e.CostUsd.IsZero() {
		t.Fatalf("missing cost should be zero, got %s", e.CostUsd)
	}
	if e.Tags == nil {
		t.Fatal("tags should default to empty map")
	}
}

func TestValidateRequiredFields(t *testing.T) {
	var e Event
	if err := e.Validate(); err == nil {
		t.Fatal("empty event should fail validation")
	}
	good := Event{
		RequestID: "r", Provider: "p", Model: "m", Operation: "chat",
		Status: "ok", PricingVersion: "v", SDKLang: "go", SDKVersion: "1",
	}
	good.TS = time.Now()
	if err := good.Validate(); err != nil {
		t.Fatalf("valid event failed: %v", err)
	}
}
