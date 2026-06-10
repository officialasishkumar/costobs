"""Manual event recording — for providers without a proxy adapter.

``costobs.record()`` covers anything the attribute-path proxy can't reach
(Deepgram/ElevenLabs call-style sub-clients, raw HTTP integrations, batch
jobs). It prices locally with the bundled pricing file, merges metadata with
the active request context, and ships asynchronously like every other event::

    costobs.record(
        provider="deepgram", model="nova-3", operation="audio",
        audio_seconds=resp.metadata.duration, latency_ms=42,
        feature="voicemail", customer_id="cust-7",
    )

    costobs.record(
        provider="elevenlabs", model="eleven_multilingual_v2",
        operation="audio", characters=len(text),
    )
"""

from __future__ import annotations

from typing import Any, Optional

from . import __version__
from .metadata import MetadataResolver
from .pricing import PricingEngine
from .proxy import _utc_now_iso
from .schema import Event, Usage, new_request_id
from .wrap import _get_queue, _resolve_ingest

_EMPTY_RESOLVER = MetadataResolver({})


def record(
    *,
    provider: str,
    model: str,
    operation: str = "chat",
    status: str = "ok",
    error_type: str = "",
    stream: bool = False,
    latency_ms: int = 0,
    input_tokens: int = 0,
    cached_input_tokens: int = 0,
    output_tokens: int = 0,
    reasoning_tokens: int = 0,
    tool_tokens: int = 0,
    audio_seconds: float = 0.0,
    characters: int = 0,
    image_count: int = 0,
    image_tiles: int = 0,
    cost_usd: Optional[float] = None,
    ingest_url: Optional[str] = None,
    api_key: Optional[str] = None,
    **metadata: Any,
) -> None:
    """Record one billable call. Non-blocking; never raises into the caller.

    ``cost_usd`` overrides the local pricing calculation when the caller
    already knows the exact billed amount. ``metadata`` accepts the same keys
    as the proxy path (customer_id, feature, team, prompt_version, ...);
    unknown keys become tags. The active ``request_context`` /``@trace``
    metadata is merged underneath, exactly like proxied calls.
    """
    usage = Usage(
        input_tokens=input_tokens,
        cached_input_tokens=cached_input_tokens,
        output_tokens=output_tokens,
        reasoning_tokens=reasoning_tokens,
        tool_tokens=tool_tokens,
        audio_seconds=audio_seconds,
        characters=characters,
        image_count=image_count,
        image_tiles=image_tiles,
    )
    pricing = PricingEngine.default()
    cost = cost_usd if cost_usd is not None else float(pricing.cost(usage, provider, model, operation))
    meta = _EMPTY_RESOLVER.merge(metadata)

    event = Event(
        request_id=new_request_id(),
        ts=_utc_now_iso(),
        provider=provider,
        model=model,
        operation=operation,
        stream=stream,
        status=status,
        error_type=error_type,
        environment=meta.get("environment", ""),
        team=meta.get("team", ""),
        service=meta.get("service", ""),
        customer_id=meta.get("customer_id", ""),
        user_id=meta.get("user_id", ""),
        trace_id=meta.get("trace_id", ""),
        feature=meta.get("feature", ""),
        prompt_key=meta.get("prompt_key", ""),
        prompt_version=meta.get("prompt_version", ""),
        tags=meta.get("tags", {}),
        input_tokens=usage.input_tokens,
        cached_input_tokens=usage.cached_input_tokens,
        output_tokens=usage.output_tokens,
        reasoning_tokens=usage.reasoning_tokens,
        tool_tokens=usage.tool_tokens,
        total_tokens=usage.total_tokens,
        audio_seconds=usage.audio_seconds,
        characters=usage.characters,
        image_count=usage.image_count,
        image_tiles=usage.image_tiles,
        cost_usd=cost,
        pricing_version=pricing.pricing_version,
        latency_ms=latency_ms,
        sdk_lang="python",
        sdk_version=__version__,
    )
    base_url, key = _resolve_ingest(ingest_url, api_key)
    _get_queue(base_url, key).enqueue(event.to_dict())
