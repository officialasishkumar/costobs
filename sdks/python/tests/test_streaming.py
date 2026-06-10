"""Streaming: usage emitted exactly once on full consumption AND early break."""

from __future__ import annotations

import asyncio

import costobs
from tests.conftest import load_fixture


class _CapturingQueue:
    def __init__(self):
        self.events = []

    def enqueue(self, ev):
        self.events.append(ev)


def _build_streaming_openai(chunks):
    import sys
    import types

    if "openai" not in sys.modules:
        sys.modules["openai"] = types.ModuleType("openai")

    class _Completions:
        def create(self, *args, **kwargs):
            # Echo back stream_options so the test can assert injection.
            self.last_kwargs = dict(kwargs)
            return iter(list(chunks))

    class _Chat:
        def __init__(self):
            self.completions = _Completions()

    class OpenAI:
        __module__ = "openai"

        def __init__(self):
            self.chat = _Chat()

    OpenAI.__module__ = "openai"
    return OpenAI()


def _wrap_capture(client):
    obs = costobs.wrap(client, api_key="k")
    cap = _CapturingQueue()
    object.__getattribute__(obs, "_recorder").queue = cap
    return obs, cap


def test_stream_options_injected_when_streaming():
    chunks = load_fixture("openai_stream_chunks.json")
    client = _build_streaming_openai(chunks)
    obs, cap = _wrap_capture(client)
    stream = obs.chat.completions.create(model="gpt-4o", messages=[], stream=True)
    list(stream)
    forwarded = object.__getattribute__(obs, "_target").chat.completions.last_kwargs
    assert forwarded["stream_options"] == {"include_usage": True}


def test_usage_emitted_once_on_full_consumption():
    chunks = load_fixture("openai_stream_chunks.json")
    client = _build_streaming_openai(chunks)
    obs, cap = _wrap_capture(client)
    stream = obs.chat.completions.create(model="gpt-4o", messages=[], stream=True)
    received = list(stream)
    assert len(received) == len(chunks)
    assert len(cap.events) == 1
    ev = cap.events[0]
    assert ev["stream"] is True
    assert ev["input_tokens"] == 50
    assert ev["output_tokens"] == 12
    assert ev["total_tokens"] == 62
    assert ev["cost_usd"] > 0


def test_usage_emitted_once_on_early_break():
    chunks = load_fixture("openai_stream_chunks.json")
    client = _build_streaming_openai(chunks)
    obs, cap = _wrap_capture(client)
    stream = obs.chat.completions.create(model="gpt-4o", messages=[], stream=True)
    for i, _chunk in enumerate(stream):
        if i == 1:
            break  # triggers GeneratorExit -> finally -> emit
    assert len(cap.events) == 1
    # Usage chunk not reached, so token counts may be 0 — but exactly one event.
    assert cap.events[0]["stream"] is True


def test_no_double_emit():
    chunks = load_fixture("openai_stream_chunks.json")
    client = _build_streaming_openai(chunks)
    obs, cap = _wrap_capture(client)
    stream = obs.chat.completions.create(model="gpt-4o", messages=[], stream=True)
    gen = iter(stream)
    list(gen)
    # Exhausting again should not emit again.
    list(gen)
    assert len(cap.events) == 1


def test_async_stream_emits_once():
    chunks = load_fixture("openai_stream_chunks.json")

    import sys
    import types

    if "openai" not in sys.modules:
        sys.modules["openai"] = types.ModuleType("openai")

    class _AsyncStream:
        def __init__(self, items):
            self._items = list(items)

        def __aiter__(self):
            self._it = iter(self._items)
            return self

        async def __anext__(self):
            try:
                return next(self._it)
            except StopIteration:
                raise StopAsyncIteration

    class _Completions:
        async def create(self, *args, **kwargs):
            return _AsyncStream(chunks)

    class _Chat:
        def __init__(self):
            self.completions = _Completions()

    class AsyncOpenAI:
        __module__ = "openai"

        def __init__(self):
            self.chat = _Chat()

    AsyncOpenAI.__module__ = "openai"

    obs, cap = _wrap_capture(AsyncOpenAI())

    async def run():
        stream = await obs.chat.completions.create(model="gpt-4o", messages=[], stream=True)
        out = []
        async for chunk in stream:
            out.append(chunk)
        return out

    out = asyncio.run(run())
    assert len(out) == len(chunks)
    assert len(cap.events) == 1
    assert cap.events[0]["output_tokens"] == 12


def test_anthropic_stream_accumulator_keeps_reasoning_tokens():
    """Regression: reasoning_tokens from message_start must survive into the
    accumulated usage (previously dropped -> extended-thinking undercosted)."""
    from costobs.adapters.anthropic import AnthropicAdapter

    acc = AnthropicAdapter().new_stream_accumulator("claude-x")
    acc.feed(
        {
            "type": "message_start",
            "message": {
                "usage": {
                    "input_tokens": 100,
                    "cache_read_input_tokens": 10,
                    "cache_creation_input_tokens": 5,
                    "reasoning_tokens": 40,
                }
            },
        }
    )
    acc.feed({"type": "message_delta", "usage": {"output_tokens": 20}})
    usage = acc.result()
    assert usage.input_tokens == 105
    assert usage.cached_input_tokens == 10
    assert usage.reasoning_tokens == 40
    assert usage.output_tokens == 20
    assert usage.total_tokens == 105 + 20 + 40
