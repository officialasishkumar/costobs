/**
 * Metadata resolution with well-defined precedence.
 *
 * Precedence (later wins): client-level config < request-context
 * (AsyncLocalStorage) < call-site. null/undefined values are dropped at every
 * layer so they never clobber a real value.
 */

import { currentContext } from "./context.js";

/** Recognized event fields. Keyed by the canonical (snake_case) event key. */
const KNOWN_FIELDS = new Set([
  "environment",
  "team",
  "service",
  "customer_id",
  "user_id",
  "trace_id",
  "feature",
  "prompt_key",
  "prompt_version",
]);

/**
 * camelCase / call-site aliases mapped to canonical event field names. This
 * lets callers use idiomatic JS (`customerId`, `promptVersion`) while the
 * wire contract stays snake_case.
 */
const FIELD_ALIASES: Record<string, string> = {
  customerId: "customer_id",
  userId: "user_id",
  traceId: "trace_id",
  promptKey: "prompt_key",
  promptVersion: "prompt_version",
};

function canonicalKey(key: string): string {
  return FIELD_ALIASES[key] ?? key;
}

export interface ResolvedMetadata {
  environment?: string;
  team?: string;
  service?: string;
  customer_id?: string;
  user_id?: string;
  trace_id?: string;
  feature?: string;
  prompt_key?: string;
  prompt_version?: string;
  tags: Record<string, string>;
}

/** Call-site metadata as read from the stripped `costobs` field. */
export interface CallSiteMeta {
  feature?: string;
  promptKey?: string;
  promptVersion?: string;
  /** Also accepts snake_case for parity. */
  prompt_key?: string;
  prompt_version?: string;
  tags?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ClientMeta {
  environment?: string;
  team?: string;
  service?: string;
  tags?: Record<string, unknown>;
  [key: string]: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Holds client-level metadata and merges in higher-precedence layers. */
export class MetadataResolver {
  private readonly clientFields: Record<string, string> = {};
  private readonly clientTags: Record<string, string> = {};

  constructor(clientMeta: ClientMeta = {}) {
    for (const [rawKey, value] of Object.entries(clientMeta)) {
      if (value === undefined || value === null) continue;
      const key = canonicalKey(rawKey);
      if (key === "tags" && isPlainObject(value)) {
        this.mergeTags(this.clientTags, value);
      } else if (KNOWN_FIELDS.has(key)) {
        this.clientFields[key] = String(value);
      } else {
        this.clientTags[key] = String(value);
      }
    }
  }

  private mergeTags(
    into: Record<string, string>,
    from: Record<string, unknown>,
  ): void {
    for (const [k, v] of Object.entries(from)) {
      if (v !== undefined && v !== null) into[k] = String(v);
    }
  }

  /** Return merged metadata: client < request-context < call-site. */
  merge(callMeta: CallSiteMeta = {}): ResolvedMetadata {
    const fields: Record<string, string> = { ...this.clientFields };
    const tags: Record<string, string> = { ...this.clientTags };

    // Request-context layer (AsyncLocalStorage).
    for (const [rawKey, value] of Object.entries(currentContext())) {
      if (value === undefined || value === null) continue;
      const key = canonicalKey(rawKey);
      if (key === "tags" && isPlainObject(value)) {
        this.mergeTags(tags, value);
      } else if (KNOWN_FIELDS.has(key)) {
        fields[key] = String(value);
      } else {
        tags[key] = String(value);
      }
    }

    // Call-site layer (highest precedence).
    for (const [rawKey, value] of Object.entries(callMeta)) {
      if (value === undefined || value === null) continue;
      const key = canonicalKey(rawKey);
      if (key === "tags" && isPlainObject(value)) {
        this.mergeTags(tags, value);
      } else if (KNOWN_FIELDS.has(key)) {
        fields[key] = String(value);
      } else {
        tags[key] = String(value);
      }
    }

    return { ...fields, tags } as ResolvedMetadata;
  }
}
