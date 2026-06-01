"""Provider adapter ABC, registry, and detection.

An adapter knows three things about a provider SDK client:
  * which terminal method paths to intercept (e.g. chat.completions.create),
  * how to parse a response object into a normalized :class:`Usage`,
  * how to accumulate usage from a stream of chunks.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, List, Optional, Tuple, Type

from ..schema import Usage


class StreamingUsageAccumulator(ABC):
    """Tees usage out of streaming chunks. One instance per stream."""

    def __init__(self, adapter: "ProviderAdapter", model: str):
        self.adapter = adapter
        self.model = model
        self.usage = Usage()

    @abstractmethod
    def feed(self, chunk: Any) -> None:
        """Consume one streamed chunk, updating ``self.usage`` in place."""

    def result(self) -> Usage:
        return self.usage


class ProviderAdapter(ABC):
    #: human name stamped onto events, e.g. "openai".
    name: str = ""

    #: tuple of attribute-path tuples that are terminal create calls.
    terminal_paths: Tuple[Tuple[str, ...], ...] = ()

    @abstractmethod
    def detect(self, client: Any) -> bool:
        """Return True if ``client`` is an instance of this provider's SDK."""

    @abstractmethod
    def operation_for(self, path: Tuple[str, ...]) -> str:
        """Map a terminal path to an Event ``operation`` value."""

    @abstractmethod
    def model_from_kwargs(self, kwargs: dict) -> str:
        """Extract the model id from the call kwargs."""

    @abstractmethod
    def parse_usage(self, response: Any, operation: str) -> Usage:
        """Parse a non-streaming response into a normalized Usage."""

    @abstractmethod
    def new_stream_accumulator(self, model: str) -> StreamingUsageAccumulator:
        """Create a fresh accumulator for a streaming call."""

    def prepare_stream_kwargs(self, kwargs: dict) -> dict:
        """Optionally mutate kwargs to ensure usage is emitted while streaming."""
        return kwargs

    def is_stream(self, kwargs: dict) -> bool:
        return bool(kwargs.get("stream", False))


_REGISTRY: List[ProviderAdapter] = []


def register(adapter_cls: Type[ProviderAdapter]) -> Type[ProviderAdapter]:
    _REGISTRY.append(adapter_cls())
    return adapter_cls


def detect(client: Any) -> Optional[ProviderAdapter]:
    """Find the adapter that recognizes ``client``."""
    _ensure_loaded()
    for adapter in _REGISTRY:
        try:
            if adapter.detect(client):
                return adapter
        except Exception:
            continue
    return None


def all_adapters() -> List[ProviderAdapter]:
    _ensure_loaded()
    return list(_REGISTRY)


_LOADED = False


def _ensure_loaded() -> None:
    global _LOADED
    if _LOADED:
        return
    _LOADED = True
    # Import built-in adapters to populate the registry.
    from . import anthropic as _a  # noqa: F401
    from . import gemini as _g  # noqa: F401
    from . import openai as _o  # noqa: F401
