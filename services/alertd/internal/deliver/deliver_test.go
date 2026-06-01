package deliver

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func samplePayload() Payload {
	return Payload{
		RuleID:       7,
		RuleName:     "daily cap",
		OrgSlug:      "acme",
		Kind:         "daily_threshold",
		ObservedUSD:  150.5,
		ThresholdUSD: 100,
		Scope:        map[string]string{"provider": "openai"},
		FiredAt:      time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC),
	}
}

func TestDeliverWebhook_BodyAndSignature(t *testing.T) {
	const secret = "topsecret"
	var gotBody []byte
	var gotSig string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		gotSig = r.Header.Get(SignatureHeader)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	d := New(srv.Client())
	p := samplePayload()
	tgt := Target{Kind: KindWebhook, Config: map[string]any{"url": srv.URL, "secret": secret}}

	if err := d.Deliver(context.Background(), tgt, p); err != nil {
		t.Fatalf("deliver: %v", err)
	}

	// Body must decode back to the payload.
	var got Payload
	if err := json.Unmarshal(gotBody, &got); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if got.RuleID != p.RuleID || got.RuleName != p.RuleName || got.ObservedUSD != p.ObservedUSD {
		t.Errorf("payload roundtrip mismatch: %+v", got)
	}
	if got.Scope["provider"] != "openai" {
		t.Errorf("scope not delivered: %+v", got.Scope)
	}

	// Signature must verify against the exact bytes received.
	if gotSig == "" {
		t.Fatal("missing signature header")
	}
	if !VerifySignature(secret, gotBody, gotSig) {
		t.Errorf("signature did not verify: %s", gotSig)
	}
	if VerifySignature("wrong", gotBody, gotSig) {
		t.Error("signature verified under wrong secret")
	}
}

func TestDeliverWebhook_NoSecretNoSignature(t *testing.T) {
	var hadSig bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hadSig = r.Header.Get(SignatureHeader) != ""
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	d := New(srv.Client())
	tgt := Target{Kind: KindWebhook, Config: map[string]any{"url": srv.URL}}
	if err := d.Deliver(context.Background(), tgt, samplePayload()); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if hadSig {
		t.Error("signature header present without configured secret")
	}
}

func TestDeliverSlack_PayloadShape(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	d := New(srv.Client())
	tgt := Target{Kind: KindSlack, Config: map[string]any{"url": srv.URL}}
	if err := d.Deliver(context.Background(), tgt, samplePayload()); err != nil {
		t.Fatalf("deliver: %v", err)
	}

	if _, ok := body["text"]; !ok {
		t.Error("slack payload missing top-level text")
	}
	atts, ok := body["attachments"].([]any)
	if !ok || len(atts) != 1 {
		t.Fatalf("expected 1 attachment, got %v", body["attachments"])
	}
	att := atts[0].(map[string]any)
	if att["color"] != "#d93025" {
		t.Errorf("attachment color = %v", att["color"])
	}
	if _, ok := att["blocks"].([]any); !ok {
		t.Error("attachment missing blocks")
	}
}

func TestDeliver_RetriesThenFails(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	d := New(srv.Client())
	d.baseWait = time.Millisecond // keep the test fast
	tgt := Target{Kind: KindWebhook, Config: map[string]any{"url": srv.URL}}

	err := d.Deliver(context.Background(), tgt, samplePayload())
	if err == nil {
		t.Fatal("expected error after exhausting retries")
	}
	if got := atomic.LoadInt32(&calls); got != int32(d.attempts) {
		t.Errorf("server hit %d times, want %d", got, d.attempts)
	}
}

func TestDeliver_RetriesThenSucceeds(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) < 2 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	d := New(srv.Client())
	d.baseWait = time.Millisecond
	tgt := Target{Kind: KindWebhook, Config: map[string]any{"url": srv.URL}}
	if err := d.Deliver(context.Background(), tgt, samplePayload()); err != nil {
		t.Fatalf("expected success on retry, got %v", err)
	}
}

func TestDeliver_UnknownKind(t *testing.T) {
	d := New(nil)
	if err := d.Deliver(context.Background(), Target{Kind: "carrierpigeon"}, samplePayload()); err == nil {
		t.Fatal("expected error for unknown target kind")
	}
}

func TestFormatScope(t *testing.T) {
	if got := formatScope(nil); got != "all traffic" {
		t.Errorf("empty scope = %q", got)
	}
	got := formatScope(map[string]string{"b": "2", "a": "1"})
	if got != "`a=1`, `b=2`" {
		t.Errorf("scope = %q, want sorted", got)
	}
}
