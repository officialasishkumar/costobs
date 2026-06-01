"""Runnable CostObs SDK demo.

Sends events through the full SDK -> ingest loop. If no real OPENAI_API_KEY is
present, it uses a fake OpenAI-shaped client so the demo runs fully offline and
still exercises wrap -> cost calc -> background ship.

Run against the local stack::

    COSTOBS_INGEST_URL=http://localhost:8080 \
    COSTOBS_API_KEY=costobs_dev_secret_key \
    python examples/quickstart.py
"""

from __future__ import annotations

import logging
import os
import sys
import types

logging.basicConfig(level=logging.INFO)

import costobs


def _fake_openai_client():
    """A minimal OpenAI-shaped client (module name 'openai' drives detection)."""
    if "openai" not in sys.modules:
        sys.modules["openai"] = types.ModuleType("openai")

    class _Usage:
        prompt_tokens = 1200
        completion_tokens = 350
        total_tokens = 1550
        prompt_tokens_details = type("D", (), {"cached_tokens": 800})()
        completion_tokens_details = type("D", (), {"reasoning_tokens": 0})()

    class _Resp:
        usage = _Usage()
        model = "gpt-4o"

    class _Completions:
        def create(self, **kwargs):
            return _Resp()

    class _Chat:
        def __init__(self):
            self.completions = _Completions()

    class OpenAI:
        __module__ = "openai"

        def __init__(self):
            self.chat = _Chat()

    OpenAI.__module__ = "openai"
    return OpenAI()


def main() -> None:
    costobs.configure(
        ingest_url=os.environ.get("COSTOBS_INGEST_URL", "http://localhost:8080"),
        api_key=os.environ.get("COSTOBS_API_KEY", "costobs_dev_secret_key"),
    )

    if os.environ.get("OPENAI_API_KEY"):
        from openai import OpenAI

        raw = OpenAI()
        print("Using real OpenAI client.")
    else:
        raw = _fake_openai_client()
        print("No OPENAI_API_KEY set — using offline fake client.")

    client = costobs.wrap(raw, team="demo", environment="dev", service="quickstart")

    with costobs.request_context(customer_id="cust-42", trace_id="trace-abc"):
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "Summarize CostObs in one line."}],
            feature="summarize",
            prompt_version="v1",
        )
        print("Provider response model:", getattr(resp, "model", "?"))

    # Drain telemetry so the demo doesn't exit before the event ships.
    costobs.flush(timeout=5.0)
    costobs.shutdown(timeout=5.0)
    print("Done. Event shipped (or logged a warning if ingest was unreachable).")


if __name__ == "__main__":
    main()
