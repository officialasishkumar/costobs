"""Shared test fixtures: offline fake provider clients and a fake ingest."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, List

import pytest

RECORDED = Path(__file__).parent / "recorded"


class Obj:
    """Recursively wraps dicts/lists so fixtures look like SDK response objects."""

    def __init__(self, data):
        for k, v in data.items():
            setattr(self, k, _wrap(v))


def _wrap(v):
    if isinstance(v, dict):
        return Obj(v)
    if isinstance(v, list):
        return [_wrap(x) for x in v]
    return v


def load_fixture(name: str):
    data = json.loads((RECORDED / name).read_text())
    if isinstance(data, list):
        return [_wrap(x) for x in data]
    return _wrap(data)


# ---- fake provider clients (module name drives adapter detection) ----

import sys
import types


def _make_fake_module(root_name: str):
    if root_name not in sys.modules:
        sys.modules[root_name] = types.ModuleType(root_name)
    return sys.modules[root_name]


class _Create:
    """A callable terminal that records calls and returns a canned response."""

    def __init__(self, response_factory):
        self._response_factory = response_factory
        self.calls: List[dict] = []

    def __call__(self, *args, **kwargs):
        self.calls.append(dict(kwargs))
        return self._response_factory(kwargs)


def _build_openai_client(response_factory):
    mod = _make_fake_module("openai")

    class _Completions:
        def __init__(self):
            self.create = _Create(response_factory)

    class _Chat:
        def __init__(self):
            self.completions = _Completions()

    class OpenAI:
        __module__ = "openai"

        def __init__(self):
            self.chat = _Chat()
            self.api_key = "sk-test"

        def some_passthrough_method(self):
            return "passthrough-ok"

    OpenAI.__module__ = "openai"
    return OpenAI()


@pytest.fixture
def openai_response_obj():
    return load_fixture("openai_chat.json")


@pytest.fixture
def fake_openai(openai_response_obj):
    return _build_openai_client(lambda kwargs: openai_response_obj)


@pytest.fixture
def fake_openai_factory():
    def make(response):
        return _build_openai_client(lambda kwargs: response)

    return make


@pytest.fixture(autouse=True)
def _isolate_queues(monkeypatch):
    """Reset wrap module global queue state between tests."""
    import sys

    import costobs.wrap  # ensure submodule imported

    wrapmod = sys.modules["costobs.wrap"]

    wrapmod._QUEUES.clear()
    wrapmod._CONFIG.clear()
    yield
    for q in list(wrapmod._QUEUES.values()):
        try:
            q.shutdown(timeout=1.0)
        except Exception:
            pass
    wrapmod._QUEUES.clear()
