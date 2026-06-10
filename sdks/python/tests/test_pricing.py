"""Trust-critical pricing tests: exact Decimal arithmetic against the file."""

from __future__ import annotations

from decimal import Decimal

import pytest

from costobs.pricing import PricingEngine
from costobs.schema import Usage


@pytest.fixture(scope="module")
def engine():
    return PricingEngine()


def test_version_loaded(engine):
    assert engine.pricing_version == "2026.06"


def test_gpt4o_input_output(engine):
    # gpt-4o: input 0.0000025, output 0.00001 per token (prefix match).
    usage = Usage(input_tokens=1000, output_tokens=500)
    cost = engine.cost(usage, "openai", "gpt-4o-2024-08-06", "chat")
    expected = Decimal("0.0000025") * 1000 + Decimal("0.00001") * 500
    assert cost == expected
    assert cost == Decimal("0.0075")


def test_gpt4o_cached_tokens(engine):
    # 800 cached @ 0.00000125, 400 non-cached input @ 0.0000025, 300 out @ 0.00001
    usage = Usage(
        input_tokens=400,
        cached_input_tokens=800,
        output_tokens=300,
    )
    cost = engine.cost(usage, "openai", "gpt-4o", "chat")
    expected = (
        Decimal("0.0000025") * 400
        + Decimal("0.00000125") * 800
        + Decimal("0.00001") * 300
    )
    assert cost == expected


def test_o3_reasoning_tokens(engine):
    # o3 has explicit reasoning_per_token == output rate (0.000008).
    usage = Usage(input_tokens=500, output_tokens=2000, reasoning_tokens=1800)
    cost = engine.cost(usage, "openai", "o3-mini", "chat")
    expected = (
        Decimal("0.000002") * 500
        + Decimal("0.000008") * 2000
        + Decimal("0.000008") * 1800
    )
    assert cost == expected


def test_reasoning_falls_back_to_output(engine):
    # gpt-4o has no reasoning_per_token -> reasoning billed at output rate.
    usage = Usage(input_tokens=0, output_tokens=0, reasoning_tokens=100)
    cost = engine.cost(usage, "openai", "gpt-4o", "chat")
    assert cost == Decimal("0.00001") * 100


def test_prefix_match_anthropic(engine):
    usage = Usage(input_tokens=400, cached_input_tokens=1000, output_tokens=250)
    cost = engine.cost(usage, "anthropic", "claude-sonnet-4-20250514", "chat")
    expected = (
        Decimal("0.000003") * 400
        + Decimal("0.0000003") * 1000
        + Decimal("0.000015") * 250
    )
    assert cost == expected


def test_batch_discount_multiplier():
    yaml_text = """
version: "test"
models:
  - provider: openai
    model: batch-model
    match: exact
    input_per_token: 0.000001
    output_per_token: 0.000002
    batch_discount: 0.5
"""
    eng = PricingEngine(yaml_text)
    usage = Usage(input_tokens=1000, output_tokens=1000)
    full = eng.cost(usage, "openai", "batch-model", "chat", batch=False)
    discounted = eng.cost(usage, "openai", "batch-model", "chat", batch=True)
    assert discounted == full * Decimal("0.5")


def test_finetune_surcharge_multiplier():
    yaml_text = """
version: "test"
models:
  - provider: openai
    model: ft-model
    match: exact
    input_per_token: 0.000001
    output_per_token: 0.000002
    finetune_surcharge: 1.5
"""
    eng = PricingEngine(yaml_text)
    usage = Usage(input_tokens=1000, output_tokens=1000)
    base = eng.cost(usage, "openai", "ft-model", "chat", finetuned=False)
    surcharged = eng.cost(usage, "openai", "ft-model", "chat", finetuned=True)
    assert surcharged == base * Decimal("1.5")


def test_audio_per_second(engine):
    usage = Usage(audio_seconds=60.0)
    cost = engine.cost(usage, "deepgram", "nova-3", "audio")
    assert cost == Decimal("0.0000071") * Decimal("60")


def test_image_tiles(engine):
    usage = Usage(image_count=2, image_tiles=4)
    cost = engine.cost(usage, "openai", "gpt-4o", "chat")
    # default tier per_tile 0.000213, base 0.0
    assert cost == Decimal("0.000213") * 4


def test_unknown_model_returns_zero(engine):
    usage = Usage(input_tokens=1000)
    assert engine.cost(usage, "openai", "does-not-exist", "chat") == Decimal("0")


def test_exact_beats_prefix():
    yaml_text = """
version: "test"
models:
  - provider: openai
    model: gpt
    match: prefix
    input_per_token: 0.001
    output_per_token: 0.0
  - provider: openai
    model: gpt-special
    match: exact
    input_per_token: 0.002
    output_per_token: 0.0
"""
    eng = PricingEngine(yaml_text)
    usage = Usage(input_tokens=100)
    assert eng.cost(usage, "openai", "gpt-special", "chat") == Decimal("0.002") * 100


def test_per_character_tts_pricing():
    from costobs.pricing import PricingEngine
    from costobs.schema import Usage

    engine = PricingEngine.default()
    cost = engine.cost(
        Usage(characters=1000),
        "elevenlabs",
        "eleven_multilingual_v2",
        operation="audio",
    )
    assert float(cost) == pytest.approx(0.3)  # 1000 chars * 0.0003


def test_audio_seconds_stt_pricing():
    from costobs.pricing import PricingEngine
    from costobs.schema import Usage

    engine = PricingEngine.default()
    cost = engine.cost(Usage(audio_seconds=600.0), "deepgram", "nova-3", operation="audio")
    assert float(cost) == pytest.approx(600 * 0.0000071)


def test_bedrock_model_id_pricing():
    from costobs.pricing import PricingEngine
    from costobs.schema import Usage

    engine = PricingEngine.default()
    cost = engine.cost(
        Usage(input_tokens=1000, output_tokens=100),
        "bedrock",
        "anthropic.claude-sonnet-4-6-v1:0",
    )
    assert float(cost) == pytest.approx(1000 * 0.000003 + 100 * 0.000015)
