/** OpenAI adapter (covers the openai-node client). */

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
  // Responses API uses input_tokens/output_tokens; Chat uses
  // prompt_tokens/completion_tokens. Support both.
  const prompt = readInt(usage, "prompt_tokens", readInt(usage, "input_tokens", 0));
  const completion = readInt(
    usage,
    "completion_tokens",
    readInt(usage, "output_tokens", 0),
  );
  const total = readInt(usage, "total_tokens", prompt + completion);

  let cached = 0;
  const details =
    read(usage, "prompt_tokens_details") ?? read(usage, "input_tokens_details");
  if (details !== undefined && details !== null) {
    cached = readInt(details, "cached_tokens", 0);
  }

  let reasoning = 0;
  const outDetails =
    read(usage, "completion_tokens_details") ?? read(usage, "output_tokens_details");
  if (outDetails !== undefined && outDetails !== null) {
    reasoning = readInt(outDetails, "reasoning_tokens", 0);
  }

  // Report non-cached input separately so the pricing engine bills cached
  // tokens at the discounted rate (no double counting).
  const nonCachedInput = Math.max(prompt - cached, 0);
  return makeUsage({
    input_tokens: nonCachedInput,
    cached_input_tokens: cached,
    output_tokens: completion,
    reasoning_tokens: reasoning,
    total_tokens: total,
  });
}

class OpenAIStreamAccumulator implements StreamAccumulator {
  private usage: Usage = makeUsage();

  feed(chunk: unknown): void {
    // Usage is only present on the final chunk when stream_options
    // include_usage is set. Earlier chunks carry usage = null.
    const usage = read(chunk, "usage");
    if (usage === null || usage === undefined) return;
    this.usage = usageFromObj(usage);
  }

  result(): Usage {
    return this.usage;
  }
}

class OpenAIAdapter implements ProviderAdapter {
  readonly name = "openai";
  readonly terminalPaths: readonly Path[] = [
    ["chat", "completions", "create"],
    ["responses", "create"],
    ["embeddings", "create"],
  ];

  detect(client: unknown): boolean {
    if (client === null || typeof client !== "object") return false;
    const ctorName = (client as object).constructor?.name ?? "";
    if (ctorName === "OpenAI" || ctorName === "AzureOpenAI") return true;
    // Structural fallback: chat.completions.create + embeddings present.
    const chat = read(client, "chat");
    const completions = read(chat, "completions");
    return (
      typeof read(completions, "create") === "function" &&
      typeof read(read(client, "embeddings"), "create") === "function"
    );
  }

  operationFor(path: Path): string {
    if (path[0] === "embeddings") return "embedding";
    if (path[0] === "responses") return "responses";
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
    return new OpenAIStreamAccumulator();
  }

  isStream(options: Record<string, unknown>): boolean {
    return Boolean(options.stream);
  }

  prepareStreamOptions(options: Record<string, unknown>): Record<string, unknown> {
    // Inject include_usage so the final chunk carries token counts, but never
    // override an explicit user setting.
    if (options.stream && options.stream_options === undefined) {
      return { ...options, stream_options: { include_usage: true } };
    }
    return options;
  }
}

register(new OpenAIAdapter());
export { OpenAIAdapter };
