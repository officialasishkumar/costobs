"""Shared helpers for reading values off provider response objects.

Provider responses may be pydantic models, plain objects, or dicts. These
helpers read a field regardless of shape and never raise.
"""

from __future__ import annotations

from typing import Any


def get(obj: Any, key: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def get_int(obj: Any, key: str, default: int = 0) -> int:
    v = get(obj, key, default)
    if v is None:
        return default
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def class_path(client: Any) -> str:
    """Return the fully-qualified module.class path of a client instance."""
    cls = type(client)
    return f"{cls.__module__}.{cls.__qualname__}"


def module_root(client: Any) -> str:
    return type(client).__module__.split(".", 1)[0]
