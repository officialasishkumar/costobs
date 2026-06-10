"""AWS Bedrock adapter (boto3 ``bedrock-runtime`` client, Converse API).

``converse`` responses carry camelCase usage. ``converse_stream`` returns an
EventStream envelope whose usage only arrives in the final ``metadata`` event;
intercepting it would require consuming the caller's stream, so streamed calls
are recorded with zero usage (request count + latency only) — use
``costobs.record()`` if you need exact streamed token counts.
"""

from __future__ import annotations

from typing import Any, Tuple

from ..schema import Usage
from . import ProviderAdapter, StreamingUsageAccumulator, register
from ._util import get, get_int, module_root


class _NullAccumulator(StreamingUsageAccumulator):
    def feed(self, chunk: Any) -> None:  # pragma: no cover - not reached
        return


@register
class BedrockAdapter(ProviderAdapter):
    name = "bedrock"
    terminal_paths = (("converse",), ("converse_stream",))

    def detect(self, client: Any) -> bool:
        if module_root(client) != "botocore":
            return False
        service = get(get(get(client, "meta"), "service_model"), "service_name")
        return service == "bedrock-runtime"

    def operation_for(self, path: Tuple[str, ...]) -> str:
        return "chat"

    def model_from_kwargs(self, kwargs: dict) -> str:
        return str(kwargs.get("modelId", ""))

    def parse_usage(self, response: Any, operation: str) -> Usage:
        usage = get(response, "usage")
        if usage is None:
            return Usage()
        input_tokens = get_int(usage, "inputTokens", 0)
        output_tokens = get_int(usage, "outputTokens", 0)
        cache_read = get_int(usage, "cacheReadInputTokens", 0)
        cache_write = get_int(usage, "cacheWriteInputTokens", 0)
        return Usage(
            # Cache writes are billed as (uncached) input; reads at cache rate.
            input_tokens=input_tokens + cache_write,
            cached_input_tokens=cache_read,
            output_tokens=output_tokens,
            total_tokens=get_int(usage, "totalTokens", 0),
        )

    def new_stream_accumulator(self, model: str) -> StreamingUsageAccumulator:
        return _NullAccumulator(self, model)

    def is_stream(self, kwargs: dict) -> bool:
        # converse_stream's envelope is not itself iterable; treat as
        # non-streaming and parse what we can (zero usage).
        return False
