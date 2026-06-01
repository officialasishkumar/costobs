"""Google Gemini adapter (google-genai SDK)."""

from __future__ import annotations

from typing import Any, Tuple

from ..schema import Usage
from . import ProviderAdapter, StreamingUsageAccumulator, register
from ._util import get, get_int, module_root


def _usage_from_metadata(meta: Any) -> Usage:
    prompt = get_int(meta, "prompt_token_count", 0)
    candidates = get_int(meta, "candidates_token_count", 0)
    cached = get_int(meta, "cached_content_token_count", 0)
    reasoning = get_int(meta, "thoughts_token_count", 0)
    total = get_int(meta, "total_token_count", prompt + candidates + reasoning)
    non_cached_input = max(prompt - cached, 0)
    return Usage(
        input_tokens=non_cached_input,
        cached_input_tokens=cached,
        output_tokens=candidates,
        reasoning_tokens=reasoning,
        total_tokens=total,
    )


class _GeminiStreamAccumulator(StreamingUsageAccumulator):
    def feed(self, chunk: Any) -> None:
        meta = get(chunk, "usage_metadata")
        if meta is None:
            return
        # google-genai emits cumulative usage_metadata on each chunk; the
        # last one observed wins.
        self.usage = _usage_from_metadata(meta)


@register
class GeminiAdapter(ProviderAdapter):
    name = "gemini"
    terminal_paths = (
        ("models", "generate_content"),
        ("models", "generate_content_stream"),
        ("aio", "models", "generate_content"),
        ("aio", "models", "generate_content_stream"),
    )

    def detect(self, client: Any) -> bool:
        root = module_root(client)
        return root in ("google", "google_genai")

    def operation_for(self, path: Tuple[str, ...]) -> str:
        return "chat"

    def model_from_kwargs(self, kwargs: dict) -> str:
        return str(kwargs.get("model", ""))

    def is_stream(self, kwargs: dict) -> bool:
        # google-genai distinguishes streaming by method name, not a kwarg.
        return bool(kwargs.get("stream", False))

    def parse_usage(self, response: Any, operation: str) -> Usage:
        meta = get(response, "usage_metadata")
        if meta is None:
            return Usage()
        return _usage_from_metadata(meta)

    def new_stream_accumulator(self, model: str) -> StreamingUsageAccumulator:
        return _GeminiStreamAccumulator(self, model)
