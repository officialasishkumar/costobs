"""OpenAI adapter (covers sync + async clients)."""

from __future__ import annotations

from typing import Any, Tuple

from ..schema import Usage
from . import ProviderAdapter, StreamingUsageAccumulator, register
from ._util import get, get_int, module_root


class _OpenAIStreamAccumulator(StreamingUsageAccumulator):
    def feed(self, chunk: Any) -> None:
        # Usage is only present on the final chunk when stream_options
        # include_usage is set. Earlier chunks carry usage=None.
        usage = get(chunk, "usage")
        if usage is None:
            return
        self.usage = self.adapter._usage_from_obj(usage)


@register
class OpenAIAdapter(ProviderAdapter):
    name = "openai"
    terminal_paths = (
        ("chat", "completions", "create"),
        ("responses", "create"),
        ("embeddings", "create"),
    )

    def detect(self, client: Any) -> bool:
        return module_root(client) == "openai"

    def operation_for(self, path: Tuple[str, ...]) -> str:
        if path[:1] == ("embeddings",):
            return "embedding"
        if path[:1] == ("responses",):
            return "responses"
        return "chat"

    def model_from_kwargs(self, kwargs: dict) -> str:
        return str(kwargs.get("model", ""))

    def _usage_from_obj(self, usage: Any) -> Usage:
        # Responses API uses input_tokens/output_tokens; Chat uses
        # prompt_tokens/completion_tokens. Support both.
        prompt = get_int(usage, "prompt_tokens", get_int(usage, "input_tokens", 0))
        completion = get_int(usage, "completion_tokens", get_int(usage, "output_tokens", 0))
        total = get_int(usage, "total_tokens", prompt + completion)

        cached = 0
        details = get(usage, "prompt_tokens_details") or get(usage, "input_tokens_details")
        if details is not None:
            cached = get_int(details, "cached_tokens", 0)

        reasoning = 0
        out_details = get(usage, "completion_tokens_details") or get(usage, "output_tokens_details")
        if out_details is not None:
            reasoning = get_int(out_details, "reasoning_tokens", 0)

        # Report non-cached input separately so the pricing engine bills cached
        # tokens at the discounted rate.
        non_cached_input = max(prompt - cached, 0)
        return Usage(
            input_tokens=non_cached_input,
            cached_input_tokens=cached,
            output_tokens=completion,
            reasoning_tokens=reasoning,
            total_tokens=total,
        )

    def parse_usage(self, response: Any, operation: str) -> Usage:
        usage = get(response, "usage")
        if usage is None:
            return Usage()
        return self._usage_from_obj(usage)

    def new_stream_accumulator(self, model: str) -> StreamingUsageAccumulator:
        return _OpenAIStreamAccumulator(self, model)

    def prepare_stream_kwargs(self, kwargs: dict) -> dict:
        # Inject include_usage so the final chunk carries token counts, but
        # never override an explicit user setting.
        if kwargs.get("stream"):
            opts = kwargs.get("stream_options")
            if opts is None:
                kwargs = dict(kwargs)
                kwargs["stream_options"] = {"include_usage": True}
        return kwargs
