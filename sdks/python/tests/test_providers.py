"""@trace decorator, OpenAI-compatible provider detection, and LiteLLM wrap."""

from __future__ import annotations

import asyncio
import types

import costobs
from costobs.adapters import detect
from costobs.adapters.litellm import LiteLLMAdapter
from costobs.adapters.openai import OpenAIAdapter
from costobs.context import current


# ---------------------------------------------------------------------------
# @trace decorator
# ---------------------------------------------------------------------------


def test_trace_decorator_sync():
    @costobs.trace(feature="search", customer_id="cust-9")
    def handler():
        return current()

    ctx = handler()
    assert ctx["feature"] == "search"
    assert ctx["customer_id"] == "cust-9"
    assert current() == {}  # restored after the call


def test_trace_decorator_metadata_dict_and_async():
    @costobs.trace({"team": "discovery"}, user_id="u-1")
    async def handler():
        await asyncio.sleep(0)
        return current()

    ctx = asyncio.run(handler())
    assert ctx["team"] == "discovery"
    assert ctx["user_id"] == "u-1"


def test_trace_nests_with_request_context():
    @costobs.trace(feature="outer")
    def handler():
        with costobs.request_context(customer_id="cust-1"):
            return current()

    ctx = handler()
    assert ctx["feature"] == "outer"
    assert ctx["customer_id"] == "cust-1"


# ---------------------------------------------------------------------------
# OpenAI-compatible provider detection via base_url
# ---------------------------------------------------------------------------


class _FakeOpenAIClient:
    __module__ = "openai"

    def __init__(self, base_url: str):
        self.base_url = base_url


def test_openai_compatible_provider_from_base_url():
    adapter = OpenAIAdapter()
    cases = {
        "https://api.x.ai/v1": "xai",
        "https://api.together.xyz/v1": "together",
        "https://api.fireworks.ai/inference/v1": "fireworks",
        "https://openrouter.ai/api/v1": "openrouter",
        "https://api.groq.com/openai/v1": "groq",
        "https://api.deepseek.com/v1": "deepseek",
        "https://api.mistral.ai/v1": "mistral",
        "https://myorg.openai.azure.com/": "azure-openai",
        "https://api.openai.com/v1": "openai",
        "": "openai",
    }
    for url, expected in cases.items():
        assert adapter.provider_for(_FakeOpenAIClient(url)) == expected, url


# ---------------------------------------------------------------------------
# LiteLLM
# ---------------------------------------------------------------------------


def _fake_litellm_module(usage: dict):
    mod = types.ModuleType("litellm")

    def completion(**kwargs):
        completion.last_kwargs = dict(kwargs)  # type: ignore[attr-defined]
        return {"model": kwargs.get("model"), "usage": dict(usage)}

    async def acompletion(**kwargs):
        return {"model": kwargs.get("model"), "usage": dict(usage)}

    mod.completion = completion  # type: ignore[attr-defined]
    mod.acompletion = acompletion  # type: ignore[attr-defined]
    return mod


class _CapturingQueue:
    def __init__(self):
        self.events = []

    def enqueue(self, ev):
        self.events.append(ev)


def _wrap_capture(client):
    obs = costobs.wrap(client, api_key="k")
    cap = _CapturingQueue()
    object.__getattribute__(obs, "_recorder").queue = cap
    return obs, cap


def test_litellm_detected_and_routed():
    mod = _fake_litellm_module({"prompt_tokens": 10, "completion_tokens": 5})
    assert isinstance(detect(mod), LiteLLMAdapter)

    obs, cap = _wrap_capture(mod)
    obs.completion(model="anthropic/claude-sonnet-4-6", messages=[])
    assert len(cap.events) == 1
    ev = cap.events[0]
    assert ev["provider"] == "anthropic"
    assert ev["model"] == "claude-sonnet-4-6"  # routing prefix stripped
    assert ev["input_tokens"] == 10
    assert ev["output_tokens"] == 5
    assert ev["cost_usd"] > 0  # priced via the anthropic table


def test_litellm_bare_model_falls_back_to_model_stem():
    mod = _fake_litellm_module({"prompt_tokens": 3, "completion_tokens": 2})
    obs, cap = _wrap_capture(mod)
    obs.completion(model="gpt-4o", messages=[])
    assert cap.events[0]["provider"] == "openai"
    assert cap.events[0]["model"] == "gpt-4o"


def test_litellm_unknown_prefix_passes_through():
    mod = _fake_litellm_module({"prompt_tokens": 1, "completion_tokens": 1})
    obs, cap = _wrap_capture(mod)
    obs.completion(model="sambanova/llama-3.3-70b", messages=[])
    assert cap.events[0]["provider"] == "sambanova"
    assert cap.events[0]["model"] == "llama-3.3-70b"
    assert cap.events[0]["cost_usd"] == 0  # unknown model tracked at $0
