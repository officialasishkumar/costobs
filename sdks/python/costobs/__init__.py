"""CostObs Python SDK — drop-in AI/LLM cost observability.

Quickstart::

    import costobs
    from openai import OpenAI

    client = costobs.wrap(OpenAI(), team="growth", environment="prod")
    resp = client.chat.completions.create(
        model="gpt-4o",
        messages=[...],
        feature="chat",
        prompt_version="v3",
    )

The wrapped client proxies every attribute to the real client and only
intercepts terminal create calls. The provider call always runs first; cost
calculation and shipping happen off the hot path.
"""

from __future__ import annotations

__version__ = "0.1.0"

from .context import async_request_context, request_context, trace
from .wrap import configure, flush, shutdown, wrap

__all__ = [
    "wrap",
    "request_context",
    "async_request_context",
    "trace",
    "configure",
    "flush",
    "shutdown",
    "__version__",
]
