"""Non-invasive proxy that observes provider calls.

The proxy never subclasses provider internals. It forwards every attribute
access through ``__getattr__`` and only intercepts an allowlist of terminal
method paths (per adapter). Everything else passes straight through, so the
proxy survives provider SDK version churn.

The provider call ALWAYS executes first. Cost calc + enqueue happen after the
response returns; shipping happens on a background thread. The synchronous
overhead added on the hot path is a metadata dict-merge plus a queue
``put_nowait``.
"""

from __future__ import annotations

import inspect
import time
from datetime import datetime, timezone
from typing import Any, Tuple

from . import __version__
from .adapters import ProviderAdapter
from .metadata import MetadataResolver
from .pricing import PricingEngine
from .schema import Event, Usage, new_request_id
from .telemetry import TelemetryQueue

# Call-site kwargs the SDK consumes and strips before forwarding.
_COSTOBS_KWARGS = ("feature", "prompt_key", "prompt_version", "costobs_tags")


def _utc_now_iso() -> str:
    # RFC3339 UTC with millisecond precision.
    dt = datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


class _Recorder:
    """Captures shared dependencies for a wrapped client tree."""

    __slots__ = ("adapter", "resolver", "pricing", "queue", "provider")

    def __init__(
        self,
        adapter: ProviderAdapter,
        resolver: MetadataResolver,
        pricing: PricingEngine,
        queue: TelemetryQueue,
        provider: str = "",
    ):
        self.adapter = adapter
        self.resolver = resolver
        self.pricing = pricing
        self.queue = queue
        # Resolved at wrap time (may differ from adapter.name for
        # OpenAI-compatible providers reached via base_url).
        self.provider = provider or adapter.name


class ObservedClient:
    """Attribute-path proxy around a provider client (or sub-object)."""

    # Real attributes live in __dict__; everything else proxies.
    def __init__(self, target: Any, recorder: _Recorder, path: Tuple[str, ...] = ()):
        object.__setattr__(self, "_target", target)
        object.__setattr__(self, "_recorder", recorder)
        object.__setattr__(self, "_path", path)

    def __getattr__(self, name: str) -> Any:
        # __getattr__ only runs for names not found normally, so no recursion.
        target = object.__getattribute__(self, "_target")
        recorder = object.__getattribute__(self, "_recorder")
        path = object.__getattribute__(self, "_path")

        attr = getattr(target, name)
        new_path = path + (name,)

        # Is this exact path a terminal create call we should intercept?
        if new_path in recorder.adapter.terminal_paths and callable(attr):
            return _make_wrapped_create(attr, recorder, new_path)

        # Is this path a strict prefix of any terminal path? If so, keep
        # proxying so we can reach the terminal method. If it's a leaf that
        # isn't terminal, return it untouched.
        if callable(attr) or not _is_path_prefix(new_path, recorder.adapter.terminal_paths):
            # Methods / leaves that aren't terminal pass straight through.
            # But sub-namespaces (non-callable objects on the way to a
            # terminal) must stay wrapped.
            if _is_path_prefix(new_path, recorder.adapter.terminal_paths) and not callable(attr):
                return ObservedClient(attr, recorder, new_path)
            return attr

        # Non-callable object on the path to a terminal -> keep wrapping.
        return ObservedClient(attr, recorder, new_path)

    def __setattr__(self, name: str, value: Any) -> None:
        setattr(object.__getattribute__(self, "_target"), name, value)

    def __repr__(self) -> str:
        return f"ObservedClient({object.__getattribute__(self, '_target')!r})"


def _is_path_prefix(path: Tuple[str, ...], terminals: Tuple[Tuple[str, ...], ...]) -> bool:
    return any(len(path) < len(t) and t[: len(path)] == path for t in terminals)


def _split_kwargs(kwargs: dict) -> Tuple[dict, dict]:
    """Separate CostObs call-site kwargs from provider kwargs."""
    meta: dict = {}
    for key in _COSTOBS_KWARGS:
        if key in kwargs:
            meta[key] = kwargs.pop(key)
    return meta, kwargs


def _make_wrapped_create(create_fn, recorder: _Recorder, path: Tuple[str, ...]):
    adapter = recorder.adapter
    operation = adapter.operation_for(path)

    is_async = inspect.iscoroutinefunction(create_fn)

    if is_async:

        async def async_wrapped(*args, **kwargs):
            call_meta, provider_kwargs = _split_kwargs(dict(kwargs))
            streaming = adapter.is_stream(provider_kwargs)
            if streaming:
                provider_kwargs = adapter.prepare_stream_kwargs(provider_kwargs)
            model = adapter.model_from_kwargs(provider_kwargs)
            request_id = new_request_id()
            ts = _utc_now_iso()
            start = time.perf_counter()

            try:
                result = await create_fn(*args, **provider_kwargs)
            except Exception as e:
                _emit(
                    recorder, request_id, ts, operation, model, streaming,
                    Usage(), call_meta, start, status="error",
                    error_type=type(e).__name__,
                )
                raise

            if streaming:
                return _AsyncStreamProxy(
                    result, recorder, request_id, ts, operation, model, call_meta, start
                )

            usage = adapter.parse_usage(result, operation)
            _emit(recorder, request_id, ts, operation, model, streaming, usage, call_meta, start)
            return result

        return async_wrapped

    def sync_wrapped(*args, **kwargs):
        call_meta, provider_kwargs = _split_kwargs(dict(kwargs))
        streaming = adapter.is_stream(provider_kwargs)
        if streaming:
            provider_kwargs = adapter.prepare_stream_kwargs(provider_kwargs)
        model = adapter.model_from_kwargs(provider_kwargs)
        request_id = new_request_id()
        ts = _utc_now_iso()
        start = time.perf_counter()

        # --- the provider call: nothing of ours runs before this returns ---
        try:
            result = create_fn(*args, **provider_kwargs)
        except Exception as e:
            _emit(
                recorder, request_id, ts, operation, model, streaming,
                Usage(), call_meta, start, status="error",
                error_type=type(e).__name__,
            )
            raise

        if streaming:
            return _SyncStreamProxy(
                result, recorder, request_id, ts, operation, model, call_meta, start
            )

        usage = adapter.parse_usage(result, operation)
        _emit(recorder, request_id, ts, operation, model, streaming, usage, call_meta, start)
        return result

    return sync_wrapped


def _emit(
    recorder: _Recorder,
    request_id: str,
    ts: str,
    operation: str,
    model: str,
    stream: bool,
    usage: Usage,
    call_meta: dict,
    start: float,
    *,
    status: str = "ok",
    error_type: str = "",
) -> None:
    """Build the event and enqueue it. Off the hot path of the provider call."""
    latency_ms = int((time.perf_counter() - start) * 1000)
    meta = recorder.resolver.merge(call_meta)
    adapter = recorder.adapter
    provider = adapter.provider_for_call(model, call_meta) or recorder.provider
    # Normalized for both pricing and the stamped event (strips routing
    # prefixes like LiteLLM's "anthropic/claude-...").
    model = adapter.normalize_model(model)

    cost = recorder.pricing.cost(usage, provider, model, operation)

    event = Event(
        request_id=request_id,
        ts=ts,
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
        image_count=usage.image_count,
        image_tiles=usage.image_tiles,
        cost_usd=float(cost),
        pricing_version=recorder.pricing.pricing_version,
        latency_ms=latency_ms,
        sdk_lang="python",
        sdk_version=__version__,
    )
    recorder.queue.enqueue(event.to_dict())


class _SyncStreamProxy:
    """Passthrough iterator that tees usage and emits exactly once at the end."""

    def __init__(self, stream, recorder, request_id, ts, operation, model, call_meta, start):
        self._stream = stream
        self._recorder = recorder
        self._request_id = request_id
        self._ts = ts
        self._operation = operation
        self._model = model
        self._call_meta = call_meta
        self._start = start
        self._acc = recorder.adapter.new_stream_accumulator(model)
        self._emitted = False

    def __iter__(self):
        try:
            for chunk in self._stream:
                try:
                    self._acc.feed(chunk)
                except Exception:
                    pass
                yield chunk
        finally:
            # Fires on full exhaustion AND on early break (GeneratorExit).
            self._finish()

    def _finish(self, status: str = "ok", error_type: str = ""):
        if self._emitted:
            return
        self._emitted = True
        _emit(
            self._recorder, self._request_id, self._ts, self._operation,
            self._model, True, self._acc.result(), self._call_meta, self._start,
            status=status, error_type=error_type,
        )

    # Forward context-manager protocol (OpenAI streams support `with`).
    def __enter__(self):
        if hasattr(self._stream, "__enter__"):
            self._stream.__enter__()
        return self

    def __exit__(self, exc_type, exc, tb):
        self._finish(
            status="error" if exc_type else "ok",
            error_type=exc_type.__name__ if exc_type else "",
        )
        if hasattr(self._stream, "__exit__"):
            return self._stream.__exit__(exc_type, exc, tb)
        return False

    def __getattr__(self, name):
        return getattr(self._stream, name)


class _AsyncStreamProxy:
    """Async passthrough iterator that tees usage and emits exactly once."""

    def __init__(self, stream, recorder, request_id, ts, operation, model, call_meta, start):
        self._stream = stream
        self._recorder = recorder
        self._request_id = request_id
        self._ts = ts
        self._operation = operation
        self._model = model
        self._call_meta = call_meta
        self._start = start
        self._acc = recorder.adapter.new_stream_accumulator(model)
        self._emitted = False

    async def __aiter__(self):
        try:
            async for chunk in self._stream:
                try:
                    self._acc.feed(chunk)
                except Exception:
                    pass
                yield chunk
        finally:
            self._finish()

    def _finish(self, status: str = "ok", error_type: str = ""):
        if self._emitted:
            return
        self._emitted = True
        _emit(
            self._recorder, self._request_id, self._ts, self._operation,
            self._model, True, self._acc.result(), self._call_meta, self._start,
            status=status, error_type=error_type,
        )

    async def __aenter__(self):
        if hasattr(self._stream, "__aenter__"):
            await self._stream.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc, tb):
        self._finish(
            status="error" if exc_type else "ok",
            error_type=exc_type.__name__ if exc_type else "",
        )
        if hasattr(self._stream, "__aexit__"):
            return await self._stream.__aexit__(exc_type, exc, tb)
        return False

    def __getattr__(self, name):
        return getattr(self._stream, name)
