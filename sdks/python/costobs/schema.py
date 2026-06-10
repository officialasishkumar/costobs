"""Wire contract types for CostObs telemetry.

`Event` mirrors ``shared/proto/event.schema.json`` 1:1. No prompt or
response bodies are ever carried here — token counts and metadata only.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict


@dataclass
class Usage:
    """Normalized, provider-agnostic usage container.

    Adapters parse provider-specific response shapes into this. Token
    fields default to 0 so the pricing engine and event builder can treat
    them uniformly.
    """

    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    tool_tokens: int = 0
    total_tokens: int = 0
    audio_seconds: float = 0.0
    characters: int = 0
    image_count: int = 0
    image_tiles: int = 0

    def __post_init__(self) -> None:
        # If a provider doesn't give an explicit total, derive a sensible one.
        if not self.total_tokens:
            self.total_tokens = (
                self.input_tokens + self.output_tokens + self.reasoning_tokens
            )


@dataclass(frozen=True)
class Event:
    """A single telemetry event. Field names == JSON keys == ClickHouse columns."""

    # --- required ---
    request_id: str
    ts: str
    provider: str
    model: str
    operation: str
    status: str
    pricing_version: str
    sdk_lang: str
    sdk_version: str

    # --- optional / defaulted ---
    stream: bool = False
    error_type: str = ""

    environment: str = ""
    team: str = ""
    service: str = ""
    customer_id: str = ""
    user_id: str = ""
    trace_id: str = ""
    feature: str = ""
    prompt_key: str = ""
    prompt_version: str = ""
    tags: Dict[str, str] = field(default_factory=dict)

    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    tool_tokens: int = 0
    total_tokens: int = 0
    audio_seconds: float = 0.0
    characters: int = 0
    image_count: int = 0
    image_tiles: int = 0

    cost_usd: float = 0.0

    latency_ms: int = 0

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to a JSON-ready dict matching event.schema.json exactly."""
        return {
            "request_id": self.request_id,
            "ts": self.ts,
            "provider": self.provider,
            "model": self.model,
            "operation": self.operation,
            "stream": self.stream,
            "status": self.status,
            "error_type": self.error_type,
            "environment": self.environment,
            "team": self.team,
            "service": self.service,
            "customer_id": self.customer_id,
            "user_id": self.user_id,
            "trace_id": self.trace_id,
            "feature": self.feature,
            "prompt_key": self.prompt_key,
            "prompt_version": self.prompt_version,
            "tags": dict(self.tags),
            "input_tokens": self.input_tokens,
            "cached_input_tokens": self.cached_input_tokens,
            "output_tokens": self.output_tokens,
            "reasoning_tokens": self.reasoning_tokens,
            "tool_tokens": self.tool_tokens,
            "total_tokens": self.total_tokens,
            "audio_seconds": self.audio_seconds,
            "characters": self.characters,
            "image_count": self.image_count,
            "image_tiles": self.image_tiles,
            "cost_usd": self.cost_usd,
            "pricing_version": self.pricing_version,
            "latency_ms": self.latency_ms,
            "sdk_lang": self.sdk_lang,
            "sdk_version": self.sdk_version,
        }


def new_request_id() -> str:
    """Generate a client-side ULID (Crockford base32, 26 chars, time-sortable)."""
    import os
    import time

    _ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    ts_ms = int(time.time() * 1000)
    rand = int.from_bytes(os.urandom(10), "big")
    value = (ts_ms << 80) | rand
    out = bytearray(26)
    for i in range(25, -1, -1):
        out[i] = ord(_ENC[value & 0x1F])
        value >>= 5
    return out.decode("ascii")
