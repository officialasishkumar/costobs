/**
 * Background telemetry shipping.
 *
 * Design goals (from the spec):
 *   - The synchronous hot path is a single bounded-array push.
 *   - A background timer batches events by count (N) or time (T) and POSTs them.
 *   - Graceful degradation: unreachable ingest -> log + drop (after retries).
 *     A 429 backpressure response is retried with backoff, not dropped.
 *   - Bounded buffer: when full, the new event is dropped + a warning logged,
 *     never blocking the caller.
 */

import type { Event } from "./schema.js";

/* eslint-disable no-console */
const warn = (msg: string, ...args: unknown[]): void => {
  console.warn(`costobs: ${msg}`, ...args);
};

export interface Sender {
  /** POST a batch. Resolve with the HTTP status code, or null on transport error. */
  send(events: Array<Record<string, unknown>>): Promise<number | null>;
  close?(): void | Promise<void>;
}

/** Default fetch-based POST sender. */
export class HttpSender implements Sender {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, apiKey: string, timeoutMs = 5000) {
    this.url = baseUrl.replace(/\/+$/, "") + "/v1/events";
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async send(events: Array<Record<string, unknown>>): Promise<number | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await fetch(this.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ events }),
        signal: controller.signal,
      });
      return resp.status;
    } catch {
      // Transport error (network down, abort, DNS, …).
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface TelemetryOptions {
  maxQueue?: number;
  batchSize?: number;
  flushIntervalMs?: number;
  maxRetries?: number;
  sender?: Sender;
  timeoutMs?: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Bounded in-memory buffer + background flush loop. */
export class TelemetryQueue {
  private readonly buffer: Array<Record<string, unknown>> = [];
  private readonly maxQueue: number;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxRetries: number;
  private readonly sender: Sender;

  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private stopped = false;
  private _dropped = 0;

  // Tracks in-flight + buffered work so flush()/shutdown() can wait for drain.
  private inFlight = 0;

  constructor(baseUrl: string, apiKey: string, opts: TelemetryOptions = {}) {
    this.maxQueue = opts.maxQueue ?? 10_000;
    this.batchSize = opts.batchSize ?? 100;
    this.flushIntervalMs = opts.flushIntervalMs ?? 1000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.sender =
      opts.sender ?? new HttpSender(baseUrl, apiKey, opts.timeoutMs ?? 5000);

    this.timer = setInterval(() => {
      void this.tick();
    }, this.flushIntervalMs);
    // Don't keep the event loop alive solely for telemetry.
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  get dropped(): number {
    return this._dropped;
  }

  /** Non-blocking enqueue. Drops + warns if the buffer is full. */
  enqueue(event: Event | Record<string, unknown>): void {
    if (this.stopped) return;
    if (this.buffer.length >= this.maxQueue) {
      this._dropped += 1;
      warn(
        `telemetry buffer full (max=${this.maxQueue}), dropping event (total dropped=${this._dropped})`,
      );
      return;
    }
    this.buffer.push(event as Record<string, unknown>);
    // Eagerly flush when a full batch has accumulated (batch-by-N).
    if (this.buffer.length >= this.batchSize) {
      void this.tick();
    }
  }

  /** Drain whole batches from the buffer and ship them. Re-entrancy guarded. */
  private async tick(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.buffer.length > 0) {
        const batch = this.buffer.splice(0, this.batchSize);
        this.inFlight += 1;
        try {
          await this.shipWithRetry(batch);
        } finally {
          this.inFlight -= 1;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private async shipWithRetry(batch: Array<Record<string, unknown>>): Promise<void> {
    if (batch.length === 0) return;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      let status: number | null;
      try {
        status = await this.sender.send(batch);
      } catch (e) {
        // Sender should not throw, but degrade gracefully if it does.
        warn(
          `ingest send failed (attempt ${attempt + 1}/${this.maxRetries}): ${String(e)}`,
        );
        status = null;
      }

      if (status === 202) return;
      if (status === 401) {
        warn(`ingest auth failed (401), dropping ${batch.length} events`);
        return;
      }
      if (status === 429) {
        // Backpressure — back off and retry this same batch.
        const backoff = Math.min(2 ** attempt * 250, 5000);
        await sleep(backoff);
        continue;
      }
      if (status === null) {
        const backoff = Math.min(2 ** attempt * 100, 2000);
        await sleep(backoff);
        continue;
      }
      // Other non-retryable status.
      warn(`ingest returned status ${status}, dropping ${batch.length} events`);
      return;
    }

    this._dropped += batch.length;
    warn(
      `dropping ${batch.length} events after ${this.maxRetries} failed attempts (total dropped=${this._dropped})`,
    );
  }

  /** Block until the buffer is empty and in-flight sends settle (best effort). */
  async flush(timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    void this.tick();
    while (Date.now() < deadline) {
      if (this.buffer.length === 0 && this.inFlight === 0 && !this.flushing) {
        return true;
      }
      await sleep(10);
      if (this.buffer.length > 0 && !this.flushing) void this.tick();
    }
    return this.buffer.length === 0 && this.inFlight === 0;
  }

  /** Drain and stop. Idempotent. */
  async shutdown(timeoutMs = 5000): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush(timeoutMs);
    if (this.sender.close) {
      try {
        await this.sender.close();
      } catch {
        // ignore
      }
    }
  }
}
