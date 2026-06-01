import { describe, expect, it } from "vitest";
import { type Sender, TelemetryQueue } from "../src/telemetry.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class RecordingSender implements Sender {
  batches: Array<Array<Record<string, unknown>>> = [];
  constructor(
    private status: number | null = 202,
    private delayMs = 0,
  ) {}
  async send(events: Array<Record<string, unknown>>): Promise<number | null> {
    if (this.delayMs) await sleep(this.delayMs);
    this.batches.push([...events]);
    return this.status;
  }
  get total(): number {
    return this.batches.reduce((s, b) => s + b.length, 0);
  }
}

const ev = (i: number): Record<string, unknown> => ({ request_id: String(i) });

describe("telemetry queue", () => {
  it("batches by count and flushes the remainder on shutdown", async () => {
    const sender = new RecordingSender();
    const q = new TelemetryQueue("http://x", "k", {
      batchSize: 10,
      flushIntervalMs: 60_000,
      sender,
    });
    for (let i = 0; i < 25; i++) q.enqueue(ev(i));
    const deadline = Date.now() + 3000;
    while (sender.total < 20 && Date.now() < deadline) await sleep(5);
    expect(sender.total).toBeGreaterThanOrEqual(20);
    expect(sender.batches[0]!.length).toBe(10);
    await q.shutdown(2000);
    expect(sender.total).toBe(25); // remaining 5 flushed on shutdown
  });

  it("flush drains everything", async () => {
    const sender = new RecordingSender();
    const q = new TelemetryQueue("http://x", "k", {
      batchSize: 1000,
      flushIntervalMs: 60_000,
      sender,
    });
    for (let i = 0; i < 50; i++) q.enqueue(ev(i));
    await q.shutdown(3000);
    expect(sender.total).toBe(50);
  });

  it("drops without blocking when the buffer is full", async () => {
    const sender = new RecordingSender(202, 500); // slow sender
    const q = new TelemetryQueue("http://x", "k", {
      maxQueue: 5,
      batchSize: 1,
      flushIntervalMs: 60_000,
      sender,
    });
    const start = Date.now();
    for (let i = 0; i < 1000; i++) q.enqueue(ev(i));
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000); // enqueue never blocks
    expect(q.dropped).toBeGreaterThan(0);
    await q.shutdown(1000);
  });

  it("degrades gracefully when ingest is unreachable", async () => {
    const boom: Sender = {
      send() {
        return Promise.reject(new Error("no route to host"));
      },
    };
    const q = new TelemetryQueue("http://x", "k", {
      batchSize: 1,
      flushIntervalMs: 60_000,
      maxRetries: 2,
      sender: boom,
    });
    // Should not throw into the caller.
    expect(() => {
      q.enqueue(ev(1));
      q.enqueue(ev(2));
    }).not.toThrow();
    await q.shutdown(3000);
    expect(q.dropped).toBeGreaterThanOrEqual(1);
  });

  it("retries a 429 backpressure response and eventually delivers", async () => {
    let calls = 0;
    let delivered = 0;
    const sender: Sender = {
      async send(events) {
        calls += 1;
        if (calls < 2) return 429;
        delivered += events.length;
        return 202;
      },
    };
    const q = new TelemetryQueue("http://x", "k", {
      batchSize: 1,
      flushIntervalMs: 60_000,
      maxRetries: 5,
      sender,
    });
    q.enqueue(ev(1));
    await q.shutdown(3000);
    expect(delivered).toBe(1);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("transport error returns null from HttpSender (no throw)", async () => {
    const { HttpSender } = await import("../src/telemetry.js");
    const sender = new HttpSender("http://127.0.0.1:0", "k", 200);
    const status = await sender.send([ev(1)]);
    expect(status).toBeNull();
  });
});
