"""Request-scoped metadata propagated via a ContextVar.

A ContextVar (not thread-local) is used so the values propagate correctly
across ``asyncio`` await boundaries within a task, while staying isolated
between concurrent tasks/threads.
"""

from __future__ import annotations

import contextlib
import functools
import inspect
from contextvars import ContextVar
from typing import Any, Callable, Dict, Iterator, Optional, TypeVar

F = TypeVar("F", bound=Callable[..., Any])

_REQUEST_CTX: ContextVar[Dict[str, Any]] = ContextVar("costobs_request_ctx", default={})


def current() -> Dict[str, Any]:
    """Return the current request-context dict (empty if none set)."""
    return dict(_REQUEST_CTX.get())


def _build(
    customer_id: Optional[str],
    user_id: Optional[str],
    trace_id: Optional[str],
    extra: Dict[str, Any],
) -> Dict[str, Any]:
    data: Dict[str, Any] = {}
    if customer_id is not None:
        data["customer_id"] = customer_id
    if user_id is not None:
        data["user_id"] = user_id
    if trace_id is not None:
        data["trace_id"] = trace_id
    data.update({k: v for k, v in extra.items() if v is not None})
    # Merge over any already-active context so nesting accumulates.
    merged = dict(_REQUEST_CTX.get())
    merged.update(data)
    return merged


@contextlib.contextmanager
def request_context(
    customer_id: Optional[str] = None,
    user_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    **extra: Any,
) -> Iterator[Dict[str, Any]]:
    """Sync context manager attaching request metadata to enclosed calls."""
    merged = _build(customer_id, user_id, trace_id, extra)
    token = _REQUEST_CTX.set(merged)
    try:
        yield merged
    finally:
        _REQUEST_CTX.reset(token)


def trace(
    metadata: Optional[Dict[str, Any]] = None,
    *,
    customer_id: Optional[str] = None,
    user_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    **extra: Any,
) -> Callable[[F], F]:
    """Decorator: every observed call inside the function carries this metadata.

    Works on sync and async functions; nests with (and is overridden by)
    :func:`request_context` and per-call kwargs::

        @costobs.trace(feature="search", team="discovery")
        def handle_query(q): ...

        @costobs.trace({"customer_id": "cust-42"})
        async def summarize(doc): ...
    """
    merged_extra = dict(metadata or {})
    merged_extra.update(extra)

    def decorator(fn: F) -> F:
        if inspect.iscoroutinefunction(fn):

            @functools.wraps(fn)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                async with async_request_context(
                    customer_id=customer_id, user_id=user_id, trace_id=trace_id, **merged_extra
                ):
                    return await fn(*args, **kwargs)

            return async_wrapper  # type: ignore[return-value]

        @functools.wraps(fn)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            with request_context(
                customer_id=customer_id, user_id=user_id, trace_id=trace_id, **merged_extra
            ):
                return fn(*args, **kwargs)

        return sync_wrapper  # type: ignore[return-value]

    return decorator


@contextlib.asynccontextmanager
async def async_request_context(
    customer_id: Optional[str] = None,
    user_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    **extra: Any,
):
    """Async-safe variant of :func:`request_context`.

    Because the underlying storage is a ContextVar, the same value set here
    survives ``await`` points within the task.
    """
    merged = _build(customer_id, user_id, trace_id, extra)
    token = _REQUEST_CTX.set(merged)
    try:
        yield merged
    finally:
        _REQUEST_CTX.reset(token)
