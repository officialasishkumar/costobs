"""Synchronous local cost calculation from the bundled pricing file.

The pricing YAML is loaded once at import time and held in memory. All
arithmetic uses :class:`decimal.Decimal` for exactness — float rounding is
unacceptable for money.
"""

from __future__ import annotations

import threading
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from .schema import Usage

_PRICING_PKG = "costobs.data"
_PRICING_FILE = "pricing-v2026.06.yaml"


def _load_pricing_text() -> str:
    """Read the bundled pricing YAML via importlib.resources (wheel-safe)."""
    try:
        from importlib.resources import files

        return (files(_PRICING_PKG) / _PRICING_FILE).read_text(encoding="utf-8")
    except Exception:
        # Fallback for older importlib semantics.
        from importlib.resources import read_text

        return read_text(_PRICING_PKG, _PRICING_FILE)


def _dec(value) -> Decimal:
    # Convert through str to avoid binary-float artifacts.
    return Decimal(str(value))


class _ModelRule:
    __slots__ = (
        "provider",
        "model",
        "match",
        "operation",
        "input",
        "cached_input",
        "output",
        "reasoning",
        "tool",
        "image_tiers",
        "audio_per_second",
        "per_character",
        "batch_discount",
        "finetune_surcharge",
    )

    def __init__(self, raw: dict):
        self.provider: str = raw["provider"]
        self.model: str = raw["model"]
        self.match: str = raw.get("match", "exact")
        self.operation: str = raw.get("operation", "chat")
        self.input = _dec(raw["input_per_token"]) if "input_per_token" in raw else None
        self.cached_input = (
            _dec(raw["cached_input_per_token"])
            if "cached_input_per_token" in raw
            else None
        )
        self.output = (
            _dec(raw["output_per_token"]) if "output_per_token" in raw else None
        )
        self.reasoning = (
            _dec(raw["reasoning_per_token"]) if "reasoning_per_token" in raw else None
        )
        self.tool = _dec(raw["tool_per_token"]) if "tool_per_token" in raw else None
        self.image_tiers: List[dict] = raw.get("image_tiers", []) or []
        self.audio_per_second = (
            _dec(raw["audio_per_second"]) if "audio_per_second" in raw else None
        )
        self.per_character = (
            _dec(raw["per_character"]) if "per_character" in raw else None
        )
        self.batch_discount = (
            _dec(raw["batch_discount"]) if "batch_discount" in raw else None
        )
        self.finetune_surcharge = (
            _dec(raw["finetune_surcharge"]) if "finetune_surcharge" in raw else None
        )

    def matches(self, provider: str, model: str) -> bool:
        if self.provider != provider:
            return False
        if self.match == "prefix":
            return model.startswith(self.model)
        return model == self.model


class PricingEngine:
    """Loads pricing rules and computes per-call cost."""

    _DEFAULT: Optional["PricingEngine"] = None
    _LOCK = threading.Lock()

    def __init__(self, yaml_text: Optional[str] = None):
        import yaml

        text = yaml_text if yaml_text is not None else _load_pricing_text()
        data = yaml.safe_load(text)
        self.version: str = str(data.get("version", ""))
        self.currency: str = data.get("currency", "USD")
        self._rules: List[_ModelRule] = [_ModelRule(m) for m in data.get("models", [])]
        # Cache resolved (provider, model) -> rule lookups.
        self._cache: Dict[Tuple[str, str], Optional[_ModelRule]] = {}

    @classmethod
    def default(cls) -> "PricingEngine":
        if cls._DEFAULT is None:
            with cls._LOCK:
                if cls._DEFAULT is None:
                    cls._DEFAULT = cls()
        return cls._DEFAULT

    @property
    def pricing_version(self) -> str:
        return self.version

    def _find(self, provider: str, model: str) -> Optional[_ModelRule]:
        key = (provider, model)
        if key in self._cache:
            return self._cache[key]
        found: Optional[_ModelRule] = None
        # Exact matches take priority over prefix matches.
        exacts = [r for r in self._rules if r.match == "exact" and r.matches(provider, model)]
        if exacts:
            found = exacts[0]
        else:
            prefixes = [r for r in self._rules if r.match == "prefix" and r.matches(provider, model)]
            if prefixes:
                # Longest prefix wins (most specific).
                found = max(prefixes, key=lambda r: len(r.model))
        self._cache[key] = found
        return found

    def cost(
        self,
        usage: Usage,
        provider: str,
        model: str,
        operation: str = "chat",
        batch: bool = False,
        finetuned: bool = False,
    ) -> Decimal:
        """Compute the cost in USD for one call. Returns Decimal('0') if unknown."""
        rule = self._find(provider, model)
        if rule is None:
            return Decimal("0")

        total = Decimal("0")

        # Token-priced components. Cached tokens are billed at the cached rate
        # and are assumed to be a subset already excluded from input_tokens by
        # the adapters (adapters report non-cached input separately).
        if rule.input is not None:
            total += rule.input * usage.input_tokens
        if usage.cached_input_tokens:
            cached_rate = rule.cached_input if rule.cached_input is not None else rule.input
            if cached_rate is not None:
                total += cached_rate * usage.cached_input_tokens
        if rule.output is not None:
            total += rule.output * usage.output_tokens
        if usage.reasoning_tokens:
            reasoning_rate = rule.reasoning if rule.reasoning is not None else rule.output
            if reasoning_rate is not None:
                total += reasoning_rate * usage.reasoning_tokens
        if usage.tool_tokens and rule.tool is not None:
            total += rule.tool * usage.tool_tokens

        # Audio (per second).
        if usage.audio_seconds and rule.audio_per_second is not None:
            total += rule.audio_per_second * _dec(usage.audio_seconds)

        # Characters (e.g. TTS input text).
        if usage.characters and rule.per_character is not None:
            total += rule.per_character * usage.characters

        # Images (per tile within the first/default tier + flat base per image).
        if usage.image_tiles and rule.image_tiers:
            tier = rule.image_tiers[0]
            per_tile = _dec(tier.get("per_tile", 0))
            base = _dec(tier.get("base", 0))
            total += per_tile * usage.image_tiles
            if usage.image_count:
                total += base * usage.image_count

        # Multipliers.
        if batch and rule.batch_discount is not None:
            total *= rule.batch_discount
        if finetuned and rule.finetune_surcharge is not None:
            total *= rule.finetune_surcharge

        return total
