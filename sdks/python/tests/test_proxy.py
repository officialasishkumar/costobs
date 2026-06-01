"""Proxy behavior: passthrough, interception, kwarg stripping, ordering."""

from __future__ import annotations

import time

import costobs
from costobs.proxy import ObservedClient


class _CapturingQueue:
    def __init__(self):
        self.events = []

    def enqueue(self, ev):
        self.events.append(ev)


def _wrap_with_capture(client):
    obs = costobs.wrap(client, team="t", environment="test", api_key="k")
    cap = _CapturingQueue()
    object.__getattribute__(obs, "_recorder").queue = cap
    return obs, cap


def test_unknown_attributes_pass_through(fake_openai):
    obs, _ = _wrap_with_capture(fake_openai)
    assert obs.api_key == "sk-test"
    assert obs.some_passthrough_method() == "passthrough-ok"


def test_terminal_create_is_intercepted(fake_openai):
    obs, cap = _wrap_with_capture(fake_openai)
    resp = obs.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": "hi"}])
    assert resp is object.__getattribute__(obs, "_target").chat.completions.create._response_factory({})
    assert len(cap.events) == 1
    ev = cap.events[0]
    assert ev["provider"] == "openai"
    assert ev["model"] == "gpt-4o"
    assert ev["operation"] == "chat"
    assert ev["team"] == "t"
    assert ev["input_tokens"] == 400  # 1200 prompt - 800 cached
    assert ev["cached_input_tokens"] == 800
    assert ev["output_tokens"] == 300
    assert ev["cost_usd"] > 0
    assert ev["pricing_version"] == "2026.06"
    assert ev["sdk_lang"] == "python"


def test_costobs_kwargs_stripped_before_forwarding(fake_openai):
    obs, cap = _wrap_with_capture(fake_openai)
    obs.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "hi"}],
        feature="search",
        prompt_key="pk1",
        prompt_version="v3",
        costobs_tags={"exp": "B"},
    )
    forwarded = object.__getattribute__(obs, "_target").chat.completions.create.calls[-1]
    for k in ("feature", "prompt_key", "prompt_version", "costobs_tags"):
        assert k not in forwarded
    assert forwarded["model"] == "gpt-4o"

    ev = cap.events[-1]
    assert ev["feature"] == "search"
    assert ev["prompt_key"] == "pk1"
    assert ev["prompt_version"] == "v3"
    assert ev["tags"]["exp"] == "B"


def test_network_path_sacred_response_before_enqueue(fake_openai_factory):
    """The real provider call must return before any telemetry enqueue."""
    order = []

    class _TimedObj:
        def __init__(self):
            self.usage = type("U", (), {
                "prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15,
                "prompt_tokens_details": None, "completion_tokens_details": None,
            })()

    def response_factory(kwargs):
        order.append("provider_returned")
        return _TimedObj()

    # Build a client whose create records ordering.
    client = fake_openai_factory(_TimedObj())
    # Override the create to log ordering.
    real_create = client.chat.completions.create

    def logging_create(*a, **k):
        order.append("provider_returned")
        return real_create(*a, **k)

    client.chat.completions.create = logging_create

    obs = costobs.wrap(client, api_key="k")

    class _OrderQueue:
        def enqueue(self, ev):
            order.append("enqueued")

    object.__getattribute__(obs, "_recorder").queue = _OrderQueue()
    obs.chat.completions.create(model="gpt-4o", messages=[])

    assert order == ["provider_returned", "enqueued"]


def test_error_emits_error_event(fake_openai_factory):
    client = fake_openai_factory(None)

    def boom(*a, **k):
        raise RuntimeError("provider down")

    client.chat.completions.create = boom
    obs = costobs.wrap(client, api_key="k")
    cap = _CapturingQueue()
    object.__getattribute__(obs, "_recorder").queue = cap

    import pytest

    with pytest.raises(RuntimeError):
        obs.chat.completions.create(model="gpt-4o", messages=[])

    assert len(cap.events) == 1
    assert cap.events[0]["status"] == "error"
    assert cap.events[0]["error_type"] == "RuntimeError"
