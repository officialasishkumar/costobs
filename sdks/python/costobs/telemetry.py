"""Background telemetry shipping.

Design goals (from the spec):
  * The synchronous hot path is a single ``queue.put_nowait``.
  * A daemon thread batches events by count (N) or time (T) and POSTs them.
  * Graceful degradation: unreachable ingest -> log + drop (after retries).
    A 429 backpressure response is retried with backoff, not dropped.
  * Bounded queue: when full, ``put_nowait`` raises ``Full`` -> drop + warn,
    never block the caller.
"""

from __future__ import annotations

import atexit
import json
import logging
import queue
import threading
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger("costobs")

# Prefer httpx; fall back to urllib so the SDK works with stdlib only.
try:  # pragma: no cover - import shim
    import httpx  # type: ignore

    _HAS_HTTPX = True
except Exception:  # pragma: no cover
    httpx = None  # type: ignore
    _HAS_HTTPX = False

_SENTINEL = object()


class _HttpSender:
    """Thin POST wrapper. Returns the HTTP status code, or None on transport error."""

    def __init__(self, base_url: str, api_key: str, timeout: float = 5.0):
        self.url = base_url.rstrip("/") + "/v1/events"
        self.api_key = api_key
        self.timeout = timeout
        self._client = httpx.Client(timeout=timeout) if _HAS_HTTPX else None

    def send(self, events: List[Dict[str, Any]]) -> Optional[int]:
        body = json.dumps({"events": events}).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if _HAS_HTTPX:
            resp = self._client.post(self.url, content=body, headers=headers)
            return resp.status_code
        import urllib.error
        import urllib.request

        req = urllib.request.Request(self.url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return resp.getcode()
        except urllib.error.HTTPError as e:
            return e.code

    def close(self) -> None:
        if self._client is not None:
            try:
                self._client.close()
            except Exception:
                pass


class TelemetryQueue:
    """Bounded queue + daemon sender thread."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        max_queue: int = 10_000,
        batch_size: int = 100,
        flush_interval: float = 1.0,
        max_retries: int = 3,
        sender: Optional[Any] = None,
        timeout: float = 5.0,
    ):
        self._q: "queue.Queue[Any]" = queue.Queue(maxsize=max_queue)
        self._batch_size = batch_size
        self._flush_interval = flush_interval
        self._max_retries = max_retries
        self._sender = sender if sender is not None else _HttpSender(base_url, api_key, timeout)
        self._stop = threading.Event()
        self._drained = threading.Event()
        self._dropped = 0
        self._dropped_lock = threading.Lock()
        self._thread = threading.Thread(
            target=self._run, name="costobs-telemetry", daemon=True
        )
        self._thread.start()
        atexit.register(self.shutdown)

    # ---- producer side (hot path) ----

    def enqueue(self, event_dict: Dict[str, Any]) -> None:
        """Non-blocking enqueue. Drops + warns if the queue is full."""
        try:
            self._q.put_nowait(event_dict)
        except queue.Full:
            with self._dropped_lock:
                self._dropped += 1
                dropped = self._dropped
            logger.warning(
                "costobs: telemetry queue full (max=%d), dropping event (total dropped=%d)",
                self._q.maxsize,
                dropped,
            )

    @property
    def dropped(self) -> int:
        with self._dropped_lock:
            return self._dropped

    # ---- consumer side (background thread) ----

    def _run(self) -> None:
        batch: List[Dict[str, Any]] = []
        deadline = time.monotonic() + self._flush_interval
        while True:
            timeout = max(0.0, deadline - time.monotonic())
            try:
                item = self._q.get(timeout=timeout)
            except queue.Empty:
                item = None

            if item is _SENTINEL:
                # Drain everything still queued, then flush and exit.
                self._flush(batch)
                self._mark_done(len(batch))
                batch = []
                self._q.task_done()  # the sentinel itself
                self._drain_remaining()
                self._drained.set()
                return

            if item is not None:
                batch.append(item)

            now = time.monotonic()
            if len(batch) >= self._batch_size or (batch and now >= deadline):
                self._flush(batch)
                self._mark_done(len(batch))
                batch = []
                deadline = now + self._flush_interval
            elif not batch:
                deadline = now + self._flush_interval

    def _mark_done(self, n: int) -> None:
        """Account for n consumed items so ``Queue.unfinished_tasks`` (and thus
        :meth:`flush`) reflects fully-shipped work, not just dequeued work."""
        for _ in range(n):
            self._q.task_done()

    def _drain_remaining(self) -> None:
        leftovers: List[Dict[str, Any]] = []
        while True:
            try:
                item = self._q.get_nowait()
            except queue.Empty:
                break
            if item is _SENTINEL:
                self._q.task_done()
                continue
            leftovers.append(item)
            if len(leftovers) >= self._batch_size:
                self._flush(leftovers)
                self._mark_done(len(leftovers))
                leftovers = []
        if leftovers:
            self._flush(leftovers)
            self._mark_done(len(leftovers))

    def _flush(self, batch: List[Dict[str, Any]]) -> None:
        if not batch:
            return
        for attempt in range(self._max_retries):
            try:
                status = self._sender.send(batch)
            except Exception as e:  # transport failure
                logger.warning(
                    "costobs: ingest send failed (attempt %d/%d): %s",
                    attempt + 1,
                    self._max_retries,
                    e,
                )
                status = None

            if status == 202:
                return
            if status == 401:
                logger.warning("costobs: ingest auth failed (401), dropping %d events", len(batch))
                return
            if status == 429:
                # Backpressure — back off and retry this same batch.
                backoff = min(2.0 ** attempt * 0.25, 5.0)
                logger.debug("costobs: ingest backpressure (429), retrying in %.2fs", backoff)
                time.sleep(backoff)
                continue
            if status is None:
                backoff = min(2.0 ** attempt * 0.1, 2.0)
                time.sleep(backoff)
                continue
            # Other non-retryable status.
            logger.warning("costobs: ingest returned status %s, dropping %d events", status, len(batch))
            return

        with self._dropped_lock:
            self._dropped += len(batch)
            dropped = self._dropped
        logger.warning(
            "costobs: dropping %d events after %d failed attempts (total dropped=%d)",
            len(batch),
            self._max_retries,
            dropped,
        )

    # ---- lifecycle ----

    def flush(self, timeout: float = 5.0) -> bool:
        """Block until every enqueued event has been shipped (or dropped).

        ``unfinished_tasks`` counts puts minus ``task_done`` calls; the sender
        thread only marks items done after the batch containing them has been
        flushed, so reaching zero means nothing is queued *or* in flight.
        Returns True if fully drained within ``timeout``.
        """
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._q.unfinished_tasks == 0:
                return True
            time.sleep(0.01)
        return self._q.unfinished_tasks == 0

    def shutdown(self, timeout: float = 5.0) -> None:
        """Signal the sender to drain and stop. Idempotent."""
        if self._stop.is_set():
            return
        self._stop.set()
        try:
            self._q.put_nowait(_SENTINEL)
        except queue.Full:
            # Make room — drop one event so the sentinel lands.
            try:
                self._q.get_nowait()
                self._q.task_done()  # account for the dropped event
                self._q.put_nowait(_SENTINEL)
            except Exception:
                pass
        self._drained.wait(timeout=timeout)
        if hasattr(self._sender, "close"):
            self._sender.close()
