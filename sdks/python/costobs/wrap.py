"""``wrap()`` factory: turns a provider client into an observed client."""

from __future__ import annotations

import logging
import os
import threading
from typing import Any, Optional

from . import adapters as _adapters
from .metadata import MetadataResolver
from .pricing import PricingEngine
from .proxy import ObservedClient, _Recorder
from .telemetry import TelemetryQueue

logger = logging.getLogger("costobs")

_DEFAULT_BASE_URL = "http://localhost:8080"

# Telemetry queues are keyed by (base_url, api_key) and shared across wraps so
# we don't spawn a sender thread per client.
_QUEUES: dict = {}
_QUEUES_LOCK = threading.Lock()

# Global config overrides set via configure().
_CONFIG: dict = {}


def configure(*, ingest_url: Optional[str] = None, api_key: Optional[str] = None, **kwargs) -> None:
    """Set process-wide defaults applied to subsequent ``wrap()`` calls."""
    if ingest_url is not None:
        _CONFIG["ingest_url"] = ingest_url
    if api_key is not None:
        _CONFIG["api_key"] = api_key
    _CONFIG.update({k: v for k, v in kwargs.items() if v is not None})


def _resolve_ingest(ingest_url: Optional[str], api_key: Optional[str]):
    url = (
        ingest_url
        or _CONFIG.get("ingest_url")
        or os.environ.get("COSTOBS_INGEST_URL")
        or _DEFAULT_BASE_URL
    )
    key = api_key or _CONFIG.get("api_key") or os.environ.get("COSTOBS_API_KEY") or ""
    return url, key


def _get_queue(base_url: str, api_key: str) -> TelemetryQueue:
    key = (base_url, api_key)
    with _QUEUES_LOCK:
        q = _QUEUES.get(key)
        if q is None:
            q = TelemetryQueue(
                base_url,
                api_key,
                batch_size=int(_CONFIG.get("batch_size", 100)),
                flush_interval=float(_CONFIG.get("flush_interval", 1.0)),
                max_queue=int(_CONFIG.get("max_queue", 10_000)),
            )
            _QUEUES[key] = q
        return q


def wrap(
    client: Any,
    *,
    environment: Optional[str] = None,
    team: Optional[str] = None,
    service: Optional[str] = None,
    ingest_url: Optional[str] = None,
    api_key: Optional[str] = None,
    **tags: Any,
) -> ObservedClient:
    """Wrap a provider client so its calls are observed.

    Returns an :class:`ObservedClient` that proxies all attribute access to the
    real client and only intercepts the provider's terminal create methods.
    """
    adapter = _adapters.detect(client)
    if adapter is None:
        raise ValueError(
            "costobs.wrap: could not detect provider for client of type "
            f"{type(client).__module__}.{type(client).__qualname__}. "
            "Supported: openai (incl. xAI/Together/Fireworks/OpenRouter/Groq/"
            "DeepSeek/Mistral via base_url), anthropic, gemini (google-genai), "
            "litellm (pass the module)."
        )

    base_url, key = _resolve_ingest(ingest_url, api_key)
    if not key:
        logger.warning(
            "costobs: no API key configured (set COSTOBS_API_KEY, pass api_key=, "
            "or call configure()). Events will be sent without auth."
        )

    client_meta = {
        "environment": environment,
        "team": team,
        "service": service,
        "tags": dict(tags) if tags else {},
    }
    resolver = MetadataResolver(client_meta)
    pricing = PricingEngine.default()
    queue = _get_queue(base_url, key)

    recorder = _Recorder(adapter, resolver, pricing, queue, provider=adapter.provider_for(client))
    return ObservedClient(client, recorder)


def flush(timeout: float = 5.0) -> None:
    """Block until all telemetry queues are drained (best effort)."""
    with _QUEUES_LOCK:
        queues = list(_QUEUES.values())
    for q in queues:
        q.flush(timeout=timeout)


def shutdown(timeout: float = 5.0) -> None:
    """Drain and stop all telemetry queues. Safe to call multiple times."""
    with _QUEUES_LOCK:
        queues = list(_QUEUES.items())
        _QUEUES.clear()
    for _, q in queues:
        q.shutdown(timeout=timeout)
