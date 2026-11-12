import { stripHtmlTags } from "./sanitization.ts";
import type { StructuralValidationResult } from "./types.ts";

export interface StructuralSanitizationOutput {
  readonly result: StructuralValidationResult;
  readonly cleanedData: Record<string, unknown>;
}

const ASCII_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const ZERO_WIDTH_CHARS = /[\u200B\u200C\u200D\uFEFF\u2060]/g;
const BIDI_OVERRIDES = /[\u202A-\u202E\u2066-\u2069]/g;
const CONSECUTIVE_SPACES = / {2,}/g;

const DEFAULT_MAX_FIELD_LENGTH = 10_000;

function sanitizeString(value: string, fieldPath: string, modifications: string[]): string {
  let result = value;

  const beforeHtml = result;
  result = stripHtmlTags(result);
  if (result !== beforeHtml) {
    modifications.push(`${fieldPath}: stripped HTML tags`);
  }

  const beforeControl = result;
  result = result.replace(ASCII_CONTROL_CHARS, "");
  if (result !== beforeControl) {
    modifications.push(`${fieldPath}: removed ASCII control characters`);
  }

  const beforeZeroWidth = result;
  result = result.replace(ZERO_WIDTH_CHARS, "");
  if (result !== beforeZeroWidth) {
    modifications.push(`${fieldPath}: removed zero-width Unicode characters`);
  }

  const beforeBidi = result;
  result = result.replace(BIDI_OVERRIDES, "");
  if (result !== beforeBidi) {
    modifications.push(`${fieldPath}: removed bidirectional override characters`);
  }

  const beforeWhitespace = result;
  result = result.replace(CONSECUTIVE_SPACES, " ").trim();
  if (result !== beforeWhitespace) {
    modifications.push(`${fieldPath}: normalized whitespace`);
  }

  if (result.length > DEFAULT_MAX_FIELD_LENGTH) {
    result = result.slice(0, DEFAULT_MAX_FIELD_LENGTH);
    modifications.push(`${fieldPath}: truncated to ${DEFAULT_MAX_FIELD_LENGTH} characters`);
  }

  return result;
}

function sanitizeValue(value: unknown, fieldPath: string, modifications: string[]): unknown {
  if (typeof value === "string") {
    return sanitizeString(value, fieldPath, modifications);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, `${fieldPath}[${index}]`, modifications));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sanitizeValue(val, `${fieldPath}.${key}`, modifications);
    }
    return result;
  }

  return value;
}

/**
 * First stage of the ingestion boundary: recursively sanitizes every string in
 * an inbound payload and records an audit trail of each modification. Runs
 * before any pattern matching downstream, because HTML removal and whitespace
 * normalization are what make provider-wrapped text matchable.
 */
export function sanitizeAndValidateStructure(
  data: Record<string, unknown>,
): StructuralSanitizationOutput {
  const modifications: string[] = [];
  const cleanedData = sanitizeValue(data, "data", modifications) as Record<string, unknown>;

  return {
    result: {
      passed: true,
      modifications,
    },
    cleanedData,
  };
}
