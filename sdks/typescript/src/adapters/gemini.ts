/** Google Gemini adapter (@google/genai SDK). */

import { type Usage, makeUsage } from "../schema.js";
import {
  type Path,
  type ProviderAdapter,
  type StreamAccumulator,
  read,
  readInt,
  register,
} from "./base.js";

function usageFromMetadata(meta: unknown): Usage {
  // @google/genai uses camelCase field names.
  const prompt = readInt(meta, "promptTokenCount", 0);
  const candidates = readInt(meta, "candidatesTokenCount", 0);
  const cached = readInt(meta, "cachedContentTokenCount", 0);
  const reasoning = readInt(meta, "thoughtsTokenCount", 0);
  const total = readInt(meta, "totalTokenCount", prompt + candidates + reasoning);
  const nonCachedInput = Math.max(prompt - cached, 0);
  return makeUsage({
    input_tokens: nonCachedInput,
    cached_input_tokens: cached,
    output_tokens: candidates,
    reasoning_tokens: reasoning,
    total_tokens: total,
  });
}

class GeminiStreamAccumulator implements StreamAccumulator {
  private usage: Usage = makeUsage();

  feed(chunk: unknown): void {
    const meta = read(chunk, "usageMetadata");
    if (meta === null || meta === undefined) return;
    // @google/genai emits cumulative usageMetadata on each chunk; the last
    // one observed wins.
    this.usage = usageFromMetadata(meta);
  }

  result(): Usage {
    return this.usage;
  }
}

class GeminiAdapter implements ProviderAdapter {
  readonly name = "gemini";
  readonly terminalPaths: readonly Path[] = [
    ["models", "generateContent"],
    ["models", "generateContentStream"],
  ];

  detect(client: unknown): boolean {
    if (client === null || typeof client !== "object") return false;
    const ctorName = (client as object).constructor?.name ?? "";
    if (ctorName === "GoogleGenAI" || ctorName === "GoogleGenerativeAI") {
      return true;
    }
    // Structural fallback: models.generateContent present.
    const models = read(client, "models");
    return typeof read(models, "generateContent") === "function";
  }

  operationFor(_path: Path): string {
    return "chat";
  }

  modelFromOptions(options: Record<string, unknown>): string {
    return String(options.model ?? "");
  }

  isStream(options: Record<string, unknown>): boolean {
    // generateContentStream returns an async iterable directly (no `stream`
    // flag). The proxy marks the call as streaming via the method name; this
    // covers the explicit-flag case for parity.
    return Boolean(options.stream);
  }

  parseUsage(response: unknown, _operation: string): Usage {
    const meta = read(response, "usageMetadata");
    if (meta === null || meta === undefined) return makeUsage();
    return usageFromMetadata(meta);
  }

  newStreamAccumulator(_model: string): StreamAccumulator {
    return new GeminiStreamAccumulator();
  }

  prepareStreamOptions(options: Record<string, unknown>): Record<string, unknown> {
    return options;
  }
}

register(new GeminiAdapter());
export { GeminiAdapter };
