"""LiteLLM adapter — observe ``litellm`` module-level calls.

LiteLLM is a router, not a client: ``costobs.wrap(litellm)`` wraps the module
itself and intercepts ``completion`` / ``acompletion`` / ``embedding`` /
``aembedding``. The provider is derived per call from the model's routing
prefix (``"anthropic/claude-..."``), which is stripped before pricing and
before the model is stamped onto the event.
"""

from __future__ import annotations

import types
from typing import Any, Optional, Tuple

from ..schema import Usage
from . import ProviderAdapter, StreamingUsageAccumulator, register
from ._util import get
from .openai import usage_from_openai_obj

#: LiteLLM routing prefix -> CostObs provider name. Prefixes not listed here
#: pass through verbatim (they are usually already the provider name).
_PREFIX_PROVIDERS = {
    "openai": "openai",
    "azure": "azure-openai",
    "anthropic": "anthropic",
    "gemini": "gemini",
    "vertex_ai": "gemini",
    "bedrock": "bedrock",
    "xai": "xai",
    "groq": "groq",
    "mistral": "mistral",
    "deepseek": "deepseek",
    "together_ai": "together",
    "fireworks_ai": "fireworks",
    "openrouter": "openrouter",
}

#: Bare-model fallbacks when no routing prefix is present.
_MODEL_PROVIDERS = (
    ("gpt-", "openai"),
    ("o3", "openai"),
    ("o4", "openai"),
    ("claude-", "anthropic"),
    ("gemini-", "gemini"),
    ("grok-", "xai"),
    ("mistral-", "mistral"),
    ("deepseek-", "deepseek"),
)


def _split_model(model: str) -> Tuple[Optional[str], str]:
    if "/" in model:
        prefix, rest = model.split("/", 1)
        return prefix, rest
    return None, model


class _LiteLLMStreamAccumulator(StreamingUsageAccumulator):
    def feed(self, chunk: Any) -> None:
        usage = get(chunk, "usage")
        if usage is None:
            return
        self.usage = usage_from_openai_obj(usage)


@register
class LiteLLMAdapter(ProviderAdapter):
    name = "litellm"
    terminal_paths = (
        ("completion",),
        ("acompletion",),
        ("embedding",),
        ("aembedding",),
    )

    def detect(self, client: Any) -> bool:
        return isinstance(client, types.ModuleType) and client.__name__ == "litellm"

    def operation_for(self, path: Tuple[str, ...]) -> str:
        return "embedding" if path[0].endswith("embedding") else "chat"

    def model_from_kwargs(self, kwargs: dict) -> str:
        return str(kwargs.get("model", ""))

    def provider_for_call(self, model: str, kwargs: dict) -> Optional[str]:
        prefix, rest = _split_model(model)
        if prefix is not None:
            return _PREFIX_PROVIDERS.get(prefix, prefix)
        for stem, provider in _MODEL_PROVIDERS:
            if rest.startswith(stem):
                return provider
        return self.name

    def normalize_model(self, model: str) -> str:
        return _split_model(model)[1]

    def parse_usage(self, response: Any, operation: str) -> Usage:
        usage = get(response, "usage")
        if usage is None:
            return Usage()
        return usage_from_openai_obj(usage)

    def new_stream_accumulator(self, model: str) -> StreamingUsageAccumulator:
        return _LiteLLMStreamAccumulator(self, model)

    def prepare_stream_kwargs(self, kwargs: dict) -> dict:
        # LiteLLM passes stream_options through to OpenAI-compatible backends
        # so the final chunk carries usage. Never override a user setting.
        if kwargs.get("stream") and kwargs.get("stream_options") is None:
            kwargs = dict(kwargs)
            kwargs["stream_options"] = {"include_usage": True}
        return kwargs
