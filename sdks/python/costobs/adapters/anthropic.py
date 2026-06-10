"""Anthropic adapter (covers sync + async clients)."""

from __future__ import annotations

from typing import Any, Tuple

from ..schema import Usage
from . import ProviderAdapter, StreamingUsageAccumulator, register
from ._util import get, get_int, module_root


def _usage_from_obj(usage: Any) -> Usage:
    input_tokens = get_int(usage, "input_tokens", 0)
    output_tokens = get_int(usage, "output_tokens", 0)
    cache_read = get_int(usage, "cache_read_input_tokens", 0)
    cache_creation = get_int(usage, "cache_creation_input_tokens", 0)
    # Extended thinking, if surfaced separately.
    reasoning = get_int(usage, "reasoning_tokens", 0)
    return Usage(
        # input_tokens from Anthropic already excludes cached reads; cache
        # creation is billed as (uncached) input, so fold it into input.
        input_tokens=input_tokens + cache_creation,
        cached_input_tokens=cache_read,
        output_tokens=output_tokens,
        reasoning_tokens=reasoning,
    )


class _AnthropicStreamAccumulator(StreamingUsageAccumulator):
    def feed(self, chunk: Any) -> None:
        etype = get(chunk, "type")
        if etype == "message_start":
            message = get(chunk, "message")
            usage = get(message, "usage")
            if usage is not None:
                parsed = _usage_from_obj(usage)
                # message_start carries input usage; keep output from deltas.
                self.usage.input_tokens = parsed.input_tokens
                self.usage.cached_input_tokens = parsed.cached_input_tokens
                self.usage.reasoning_tokens = parsed.reasoning_tokens
        elif etype == "message_delta":
            usage = get(chunk, "usage")
            if usage is not None:
                self.usage.output_tokens = get_int(usage, "output_tokens", self.usage.output_tokens)
                self.usage.reasoning_tokens = get_int(
                    usage, "reasoning_tokens", self.usage.reasoning_tokens
                )
        self.usage.total_tokens = (
            self.usage.input_tokens + self.usage.output_tokens + self.usage.reasoning_tokens
        )


@register
class AnthropicAdapter(ProviderAdapter):
    name = "anthropic"
    terminal_paths = (("messages", "create"),)

    def detect(self, client: Any) -> bool:
        return module_root(client) == "anthropic"

    def operation_for(self, path: Tuple[str, ...]) -> str:
        return "chat"

    def model_from_kwargs(self, kwargs: dict) -> str:
        return str(kwargs.get("model", ""))

    def parse_usage(self, response: Any, operation: str) -> Usage:
        usage = get(response, "usage")
        if usage is None:
            return Usage()
        return _usage_from_obj(usage)

    def new_stream_accumulator(self, model: str) -> StreamingUsageAccumulator:
        return _AnthropicStreamAccumulator(self, model)
