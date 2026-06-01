/**
 * CostObs TypeScript/Node SDK — drop-in AI/LLM cost observability.
 *
 * Quickstart:
 *
 *   import OpenAI from "openai";
 *   import { wrap } from "@costobs/sdk";
 *
 *   const client = wrap(new OpenAI(), { team: "growth", environment: "prod" });
 *   const resp = await client.chat.completions.create({
 *     model: "gpt-4o",
 *     messages: [...],
 *     costobs: { feature: "chat", promptVersion: "v3" },
 *   });
 *
 * The wrapped client proxies every property to the real client and only
 * intercepts terminal create calls. The provider call always runs first; cost
 * calculation and shipping happen off the hot path.
 */

export { wrap, configure, flush, shutdown } from "./wrap.js";
export type { WrapOptions } from "./wrap.js";
export { requestContext, currentContext } from "./context.js";
export type { RequestContext } from "./context.js";
export { PricingEngine } from "./pricing.js";
export type { CostOptions } from "./pricing.js";
export { TelemetryQueue, HttpSender } from "./telemetry.js";
export type { Sender, TelemetryOptions } from "./telemetry.js";
export { MetadataResolver } from "./metadata.js";
export type { ResolvedMetadata, CallSiteMeta, ClientMeta } from "./metadata.js";
export {
  type Event,
  type Usage,
  makeUsage,
  newRequestId,
  SDK_VERSION,
  SDK_LANG,
} from "./schema.js";
