/**
 * Resilient AI wrapper — convergence-point Decorator for every structured LLM
 * call in the platform.
 *
 * PROPRIETARY: the implementation is withheld from this showcase. The public
 * surface and design are documented below and walked through live on request.
 *
 * Design:
 *   1. Retry — transient failures (`rate_limited`, `server_error`, `overloaded`,
 *      `timeout`, per `isRetryableError`) are retried with exponential backoff
 *      and jitter. HTTP 529 (overloaded) escalates once to a configured
 *      fallback model; the caller's explicit model is always the primary.
 *   2. Shape recovery — composes `tryUnwrapSingleKeyObject` into the SDK
 *      repair hook, then allows exactly one bounded regeneration with a
 *      corrective instruction when the model returns a schema-invalid root.
 *   3. Schema guard — in non-production, `assertModelFacingSchemaClean` runs
 *      before every call so an API-rejected schema fails in development.
 *   4. Usage capture — token usage and cost are attributed to the model that
 *      actually served the call, including failed attempts.
 *
 * Every service imports from here instead of the AI SDK directly, so these
 * concerns live in one place rather than at each call site.
 */

import type { ErrorClassification } from "./error-classification.ts";

const WITHHELD = "Proprietary — available in a live walkthrough.";

export interface ResilientCallOptions {
  /** Explicit model id. Always used as the primary model. */
  readonly modelId: string;
  /** Pipeline stage label used for tracing and usage attribution. */
  readonly stage: string;
  /** Abort the call (and any pending retries) at this signal. */
  readonly signal?: AbortSignal;
}

export interface ResilientObjectResult<T> {
  readonly object: T;
  /** Model that actually produced the result (may differ after 529 escalation). */
  readonly servedByModelId: string;
  readonly attempts: number;
  readonly repaired: boolean;
}

/** Raised after every retry and fallback model has been exhausted. */
export class ProviderExhaustedError extends Error {
  readonly attempts: number;
  readonly models: readonly string[];
  readonly lastClassification: ErrorClassification;

  constructor(attempts: number, models: readonly string[], last: ErrorClassification) {
    super(`Provider exhausted after ${attempts} attempts across ${models.join(", ")}`);
    this.name = "ProviderExhaustedError";
    this.attempts = attempts;
    this.models = models;
    this.lastClassification = last;
  }
}

export async function resilientGenerateObject<T>(
  _request: { readonly schema: unknown; readonly system?: string; readonly prompt: string },
  _options: ResilientCallOptions,
): Promise<ResilientObjectResult<T>> {
  throw new Error(WITHHELD);
}
