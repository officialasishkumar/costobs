# CostObs Python SDK

Drop-in AI/LLM cost observability. Wrap your provider client once; every call
emits a telemetry event (token counts + metadata + locally-computed cost) to
the CostObs ingest service — **with zero added latency on the provider call**.

- No prompt/response bodies are ever sent. Token counts + metadata only.
- The real provider call runs first; cost calc and shipping happen off the hot path on a background thread.
- Non-invasive: proxies attribute access, never subclasses provider internals.

## Install

```bash
pip install -e ".[openai]"   # or [anthropic], [gemini]
```

## Quickstart

```python
import costobs
from openai import OpenAI

# COSTOBS_INGEST_URL / COSTOBS_API_KEY can also be set via env.
client = costobs.wrap(OpenAI(), team="growth", environment="prod")

resp = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
    feature="chat",          # call-site metadata (stripped before the API call)
    prompt_version="v3",
)

costobs.flush()   # optional: drain telemetry before exit
```

## Per-request attribution (FastAPI)

```python
from fastapi import FastAPI, Request
import costobs

app = FastAPI()

@app.middleware("http")
async def attribute(request: Request, call_next):
    async with costobs.async_request_context(
        customer_id=request.headers.get("x-customer-id", ""),
        trace_id=request.headers.get("x-trace-id", ""),
    ):
        return await call_next(request)
```

Metadata precedence (later wins): client config (`wrap(...)`) < request-context
< call-site kwargs (`feature`, `prompt_key`, `prompt_version`, `costobs_tags=`).

## Supported providers

`openai` (chat / responses / embeddings), `anthropic` (messages),
`gemini` (google-genai generate_content). Sync, async, and streaming are all
handled; streaming usage is teed from the final chunk and emitted exactly once.

## Config

| Setting      | Arg / env                                  | Default                  |
|--------------|--------------------------------------------|--------------------------|
| Ingest URL   | `ingest_url=` / `COSTOBS_INGEST_URL`       | `http://localhost:8080`  |
| API key      | `api_key=` / `COSTOBS_API_KEY`             | (none)                   |

`costobs.configure(ingest_url=..., api_key=...)` sets process-wide defaults.
`costobs.flush()` / `costobs.shutdown()` drain the queue (shutdown is also
registered via `atexit`).
