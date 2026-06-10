/**
 * AWS Bedrock adapter (@aws-sdk/client-bedrock-runtime, Converse API).
 *
 * The AWS SDK uses a command pattern: `client.send(new ConverseCommand(...))`.
 * We intercept `send`; the model id lives on the command's `input.modelId` and
 * Converse responses carry camelCase usage. ConverseStream responses only
 * deliver usage in the final stream `metadata` event, so streamed calls are
 * recorded with zero usage (request count + latency only) — use `record()` if
 * exact streamed token counts are needed.
 */

import { type Usage, makeUsage } from "../schema.js";
import {
  type Path,
  type ProviderAdapter,
  type StreamAccumulator,
  read,
  readInt,
  register,
} from "./base.js";

class NullAccumulator implements StreamAccumulator {
  private usage: Usage = makeUsage();
  feed(_chunk: unknown): void {}
  result(): Usage {
    return this.usage;
  }
}

class BedrockAdapter implements ProviderAdapter {
  readonly name = "bedrock";
  readonly terminalPaths: readonly Path[] = [["send"]];

  detect(client: unknown): boolean {
    if (client === null || typeof client !== "object") return false;
    const ctorName = (client as object).constructor?.name ?? "";
    if (ctorName === "BedrockRuntimeClient") return true;
    // Structural fallback: AWS smithy clients expose config.serviceId.
    const serviceId = read(read(client, "config"), "serviceId");
    return serviceId === "Bedrock Runtime";
  }

  operationFor(_path: Path): string {
    return "chat";
  }

  modelFromOptions(options: Record<string, unknown>): string {
    // `options` is the command object; its `input` holds the request.
    return String(read(read(options, "input"), "modelId") ?? "");
  }

  parseUsage(response: unknown, _operation: string): Usage {
    const usage = read(response, "usage");
    if (usage === null || usage === undefined) return makeUsage();
    const inputTokens = readInt(usage, "inputTokens", 0);
    const outputTokens = readInt(usage, "outputTokens", 0);
    const cacheRead = readInt(usage, "cacheReadInputTokens", 0);
    const cacheWrite = readInt(usage, "cacheWriteInputTokens", 0);
    return makeUsage({
      // Cache writes are billed as (uncached) input; reads at cache rate.
      input_tokens: inputTokens + cacheWrite,
      cached_input_tokens: cacheRead,
      output_tokens: outputTokens,
      total_tokens: readInt(usage, "totalTokens", 0),
    });
  }

  newStreamAccumulator(_model: string): StreamAccumulator {
    return new NullAccumulator();
  }

  isStream(_options: Record<string, unknown>): boolean {
    // ConverseStream envelopes are not themselves iterable; treat every send
    // as non-streaming and parse what we can.
    return false;
  }

  prepareStreamOptions(options: Record<string, unknown>): Record<string, unknown> {
    return options;
  }
}

register(new BedrockAdapter());
export { BedrockAdapter };
