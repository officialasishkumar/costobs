"""Metadata precedence + ContextVar propagation across async boundaries."""

from __future__ import annotations

import asyncio

import pytest

from costobs.context import async_request_context, request_context
from costobs.metadata import MetadataResolver


def test_precedence_call_site_wins():
    resolver = MetadataResolver({"environment": "dev", "team": "core"})
    with request_context(customer_id="cust-1", trace_id="t-1"):
        merged = resolver.merge({"environment": "prod", "feature": "chat"})
    assert merged["environment"] == "prod"  # call-site overrides client
    assert merged["team"] == "core"  # client preserved
    assert merged["customer_id"] == "cust-1"  # request-context layer
    assert merged["trace_id"] == "t-1"
    assert merged["feature"] == "chat"


def test_none_values_dropped():
    resolver = MetadataResolver({"environment": "dev", "service": None})
    merged = resolver.merge({"team": None, "feature": "x"})
    assert merged.get("service", "") == ""
    assert "team" not in merged or merged.get("team", "") == ""
    assert merged["feature"] == "x"


def test_tags_merge_and_costobs_tags():
    resolver = MetadataResolver({"environment": "dev", "tags": {"region": "us"}})
    with request_context(tier="gold"):
        merged = resolver.merge({"costobs_tags": {"region": "eu", "exp": "A"}})
    tags = merged["tags"]
    assert tags["region"] == "eu"  # call-site costobs_tags wins
    assert tags["tier"] == "gold"  # request-context extra became a tag
    assert tags["exp"] == "A"


def test_request_context_resets_after_exit():
    resolver = MetadataResolver({})
    with request_context(customer_id="x"):
        pass
    merged = resolver.merge({})
    assert merged.get("customer_id", "") == ""


def test_contextvar_propagates_across_await():
    resolver = MetadataResolver({})
    seen = {}

    async def inner():
        await asyncio.sleep(0)  # cross an await boundary
        seen.update(resolver.merge({}))

    async def main():
        async with async_request_context(customer_id="async-cust", user_id="u9"):
            await inner()

    asyncio.run(main())
    assert seen["customer_id"] == "async-cust"
    assert seen["user_id"] == "u9"


def test_concurrent_tasks_isolated():
    resolver = MetadataResolver({})
    results = {}

    async def task(name):
        async with async_request_context(customer_id=name):
            await asyncio.sleep(0.01)
            results[name] = resolver.merge({})["customer_id"]

    async def main():
        await asyncio.gather(task("a"), task("b"), task("c"))

    asyncio.run(main())
    assert results == {"a": "a", "b": "b", "c": "c"}
