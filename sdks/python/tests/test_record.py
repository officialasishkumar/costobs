"""Manual record() API and the Bedrock converse adapter."""

from __future__ import annotations

import importlib

import costobs
from costobs.adapters import detect
from costobs.adapters.bedrock import BedrockAdapter

# The package re-exports the record() function under the same name as its
# module, so resolve the module explicitly for monkeypatching.
record_mod = importlib.import_module("costobs.record")


class _CapturingQueue:
    def __init__(self):
        self.events = []

    def enqueue(self, ev):
        self.events.append(ev)


def _patch_queue(monkeypatch):
    cap = _CapturingQueue()
    monkeypatch.setattr(record_mod, "_get_queue", lambda url, key: cap)
    return cap


def test_record_prices_characters(monkeypatch):
    cap = _patch_queue(monkeypatch)
    costobs.record(
        provider="elevenlabs",
        model="eleven_multilingual_v2",
        operation="audio",
        characters=1000,
        latency_ms=88,
        feature="narration",
        customer_id="cust-7",
    )
    assert len(cap.events) == 1
    ev = cap.events[0]
    assert ev["provider"] == "elevenlabs"
    assert ev["characters"] == 1000
    assert abs(ev["cost_usd"] - 0.3) < 1e-9
    assert ev["feature"] == "narration"
    assert ev["customer_id"] == "cust-7"
    assert ev["latency_ms"] == 88


def test_record_merges_request_context_and_cost_override(monkeypatch):
    cap = _patch_queue(monkeypatch)
    with costobs.request_context(customer_id="ctx-cust", trace_id="t-1"):
        costobs.record(
            provider="deepgram",
            model="nova-3",
            operation="audio",
            audio_seconds=120.0,
            cost_usd=0.5,
        )
    ev = cap.events[0]
    assert ev["customer_id"] == "ctx-cust"
    assert ev["trace_id"] == "t-1"
    assert ev["cost_usd"] == 0.5  # explicit override wins over pricing table


# ---------------------------------------------------------------------------
# Bedrock
# ---------------------------------------------------------------------------


class _ServiceModel:
    service_name = "bedrock-runtime"


class _Meta:
    service_model = _ServiceModel()


class _FakeBedrockClient:
    __module__ = "botocore.client"

    def __init__(self, usage):
        self.meta = _Meta()
        self._usage = usage

    def converse(self, **kwargs):
        return {
            "output": {"message": {"content": []}},
            "usage": dict(self._usage),
        }


def _wrap_capture(client):
    obs = costobs.wrap(client, api_key="k")
    cap = _CapturingQueue()
    object.__getattribute__(obs, "_recorder").queue = cap
    return obs, cap


def test_bedrock_detected_and_priced():
    client = _FakeBedrockClient(
        {
            "inputTokens": 1000,
            "outputTokens": 100,
            "totalTokens": 1100,
            "cacheReadInputTokens": 50,
            "cacheWriteInputTokens": 10,
        }
    )
    assert isinstance(detect(client), BedrockAdapter)

    obs, cap = _wrap_capture(client)
    obs.converse(modelId="anthropic.claude-sonnet-4-6-v1:0", messages=[])
    assert len(cap.events) == 1
    ev = cap.events[0]
    assert ev["provider"] == "bedrock"
    assert ev["model"] == "anthropic.claude-sonnet-4-6-v1:0"
    assert ev["input_tokens"] == 1010  # cache writes billed as input
    assert ev["cached_input_tokens"] == 50
    assert ev["output_tokens"] == 100
    assert ev["cost_usd"] > 0
