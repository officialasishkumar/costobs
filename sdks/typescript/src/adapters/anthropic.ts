/** Anthropic adapter (covers the @anthropic-ai/sdk client). */

import { type Usage, makeUsage } from "../schema.js";
import {
  type Path,
  type ProviderAdapter,
  type StreamAccumulator,
  read,
  readInt,
  register,
} from "./base.js";

function usageFromObj(usage: unknown): Usage {
  const inputTokens = readInt(usage, "input_tokens", 0);
  const outputTokens = readInt(usage, "output_tokens", 0);
  const cacheRead = readInt(usage, "cache_read_input_tokens", 0);
  const cacheCreation = readInt(usage, "cache_creation_input_tokens", 0);
  const reasoning = readInt(usage, "reasoning_tokens", 0);
  return makeUsage({
    // input_tokens from Anthropic already excludes cached reads; cache
    // creation is billed as (uncached) input, so fold it into input.
    input_tokens: inputTokens + cacheCreation,
    cached_input_tokens: cacheRead,
    output_tokens: outputTokens,
    reasoning_tokens: reasoning,
  });
}

class AnthropicStreamAccumulator implements StreamAccumulator {
  private usage: Usage = makeUsage();

  feed(chunk: unknown): void {
    const etype = read(chunk, "type");
    if (etype === "message_start") {
      const message = read(chunk, "message");
      const usage = read(message, "usage");
      if (usage !== null && usage !== undefined) {
        const parsed = usageFromObj(usage);
        // message_start carries input usage; keep output from deltas.
        this.usage.input_tokens = parsed.input_tokens;
        this.usage.cached_input_tokens = parsed.cached_input_tokens;
      }
    } else if (etype === "message_delta") {
      const usage = read(chunk, "usage");
      if (usage !== null && usage !== undefined) {
        this.usage.output_tokens = readInt(
          usage,
          "output_tokens",
          this.usage.output_tokens,
        );
      }
    }
    this.usage.total_tokens =
      this.usage.input_tokens +
      this.usage.output_tokens +
      this.usage.reasoning_tokens;
  }

  result(): Usage {
    return this.usage;
  }
}

class AnthropicAdapter implements ProviderAdapter {
  readonly name = "anthropic";
  readonly terminalPaths: readonly Path[] = [["messages", "create"]];

  detect(client: unknown): boolean {
    if (client === null || typeof client !== "object") return false;
    const ctorName = (client as object).constructor?.name ?? "";
    if (ctorName === "Anthropic" || ctorName === "AnthropicBedrock") return true;
    // Structural fallback: messages.create present, no chat.completions
    // (which would mark it as OpenAI-shaped).
    const messages = read(client, "messages");
    const hasMessagesCreate = typeof read(messages, "create") === "function";
    const hasChat = read(client, "chat") !== undefined;
    return hasMessagesCreate && !hasChat;
  }

  operationFor(_path: Path): string {
    return "chat";
  }

  modelFromOptions(options: Record<string, unknown>): string {
    return String(options.model ?? "");
  }

  parseUsage(response: unknown, _operation: string): Usage {
    const usage = read(response, "usage");
    if (usage === null || usage === undefined) return makeUsage();
    return usageFromObj(usage);
  }

  newStreamAccumulator(_model: string): StreamAccumulator {
    return new AnthropicStreamAccumulator();
  }

  isStream(options: Record<string, unknown>): boolean {
    return Boolean(options.stream);
  }

  prepareStreamOptions(options: Record<string, unknown>): Record<string, unknown> {
    return options;
  }
}

register(new AnthropicAdapter());
export { AnthropicAdapter };
