"""Metadata resolution with well-defined precedence.

Precedence (later wins): client-level config < request-context < call-site.
None values are dropped at every layer so they never clobber a real value.
"""

from __future__ import annotations

from typing import Any, Dict

from . import context

# Recognized top-level metadata fields that map onto Event columns.
_KNOWN_FIELDS = {
    "environment",
    "team",
    "service",
    "customer_id",
    "user_id",
    "trace_id",
    "feature",
    "prompt_key",
    "prompt_version",
}


def _clean(d: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None}


class MetadataResolver:
    """Holds client-level metadata and merges in higher-precedence layers."""

    def __init__(self, client_meta: Dict[str, Any]):
        # Split into known fields vs free-form tags.
        self.client_fields: Dict[str, Any] = {}
        self.client_tags: Dict[str, str] = {}
        for k, v in _clean(client_meta).items():
            if k == "tags" and isinstance(v, dict):
                self.client_tags.update({tk: str(tv) for tk, tv in v.items() if tv is not None})
            elif k in _KNOWN_FIELDS:
                self.client_fields[k] = v
            else:
                self.client_tags[k] = str(v)

    def merge(self, call_meta: Dict[str, Any]) -> Dict[str, Any]:
        """Return merged metadata: client < request-context < call-site."""
        fields: Dict[str, Any] = dict(self.client_fields)
        tags: Dict[str, str] = dict(self.client_tags)

        # Request-context layer.
        ctx = _clean(context.current())
        for k, v in ctx.items():
            if k == "tags" and isinstance(v, dict):
                tags.update({tk: str(tv) for tk, tv in v.items() if tv is not None})
            elif k in _KNOWN_FIELDS:
                fields[k] = v
            else:
                tags[k] = str(v)

        # Call-site layer (highest precedence).
        call = _clean(call_meta)
        call_tags = call.pop("costobs_tags", None)
        for k, v in call.items():
            if k in _KNOWN_FIELDS:
                fields[k] = v
            else:
                tags[k] = str(v)
        if isinstance(call_tags, dict):
            tags.update({tk: str(tv) for tk, tv in call_tags.items() if tv is not None})

        result: Dict[str, Any] = {k: v for k, v in fields.items()}
        result["tags"] = tags
        return result
