"""Telemetry queue: drop-on-full, batching, flush drains, graceful degradation."""

from __future__ import annotations

import threading
import time

from costobs.telemetry import TelemetryQueue


class _RecordingSender:
    def __init__(self, status=202, delay=0.0):
        self.batches = []
        self.status = status
        self.delay = delay
        self._lock = threading.Lock()

    def send(self, events):
        if self.delay:
            time.sleep(self.delay)
        with self._lock:
            self.batches.append(list(events))
        return self.status

    def close(self):
        pass

    @property
    def total(self):
        with self._lock:
            return sum(len(b) for b in self.batches)


def _ev(i):
    return {"request_id": str(i)}


def test_batches_by_count():
    sender = _RecordingSender()
    q = TelemetryQueue("http://x", "k", batch_size=10, flush_interval=60.0, sender=sender)
    for i in range(25):
        q.enqueue(_ev(i))
    # Wait for sender to ship the two full batches of 10.
    deadline = time.monotonic() + 3
    while sender.total < 20 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert sender.total >= 20
    # First two batches should be size 10.
    assert len(sender.batches[0]) == 10
    q.shutdown(timeout=2)
    assert sender.total == 25  # remaining 5 flushed on shutdown


def test_flush_drains():
    sender = _RecordingSender()
    q = TelemetryQueue("http://x", "k", batch_size=1000, flush_interval=60.0, sender=sender)
    for i in range(50):
        q.enqueue(_ev(i))
    q.shutdown(timeout=3)
    assert sender.total == 50


def test_queue_full_drops_without_blocking():
    # Slow sender so the queue fills; tiny max_queue.
    sender = _RecordingSender(delay=0.5)
    q = TelemetryQueue(
        "http://x", "k", max_queue=5, batch_size=1, flush_interval=60.0, sender=sender
    )
    start = time.monotonic()
    for i in range(1000):
        q.enqueue(_ev(i))
    elapsed = time.monotonic() - start
    # Enqueue must never block on a full queue.
    assert elapsed < 1.0
    assert q.dropped > 0
    q.shutdown(timeout=1)


def test_unreachable_ingest_degrades_gracefully():
    class _BoomSender:
        def send(self, events):
            raise ConnectionError("no route to host")

        def close(self):
            pass

    q = TelemetryQueue(
        "http://x", "k", batch_size=1, flush_interval=60.0, max_retries=2, sender=_BoomSender()
    )
    # Should not raise into the caller.
    q.enqueue(_ev(1))
    q.enqueue(_ev(2))
    q.shutdown(timeout=3)
    assert q.dropped >= 1  # dropped after retries, but never raised


def test_429_backpressure_retried():
    class _BackpressureSender:
        def __init__(self):
            self.calls = 0
            self.delivered = 0

        def send(self, events):
            self.calls += 1
            if self.calls < 2:
                return 429
            self.delivered += len(events)
            return 202

        def close(self):
            pass

    sender = _BackpressureSender()
    q = TelemetryQueue(
        "http://x", "k", batch_size=1, flush_interval=60.0, max_retries=5, sender=sender
    )
    q.enqueue(_ev(1))
    q.shutdown(timeout=3)
    assert sender.delivered == 1
    assert sender.calls >= 2
