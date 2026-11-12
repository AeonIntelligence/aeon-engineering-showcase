// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HTML_TAG_REGEX = /<[^>]*>/g;

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&#x2F;": "/",
  "&nbsp;": " ",
};

const ENTITY_REGEX = /&(?:amp|lt|gt|quot|nbsp|#39|#x27|#x2F);/g;

const ASCII_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const ZERO_WIDTH_CHARS = /[\u200B\u200C\u200D\uFEFF\u2060]/g;
const BIDI_OVERRIDES = /[\u202A-\u202E\u2066-\u2069]/g;
const VARIATION_SELECTORS = /[\uFE00-\uFE0F]/g;

const CONSECUTIVE_WHITESPACE = /[^\S\n]+/g;
const CONSECUTIVE_NEWLINES = /\n{3,}/g;
const CARRIAGE_RETURN = /\r\n?/g;

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

export interface UrlValidationEntry {
  readonly url: string;
  readonly approved: boolean;
}

export interface UrlValidationResult {
  readonly valid: boolean;
  readonly urls: readonly UrlValidationEntry[];
  readonly sanitized: string;
}

// ---------------------------------------------------------------------------
// String sanitization functions
// ---------------------------------------------------------------------------

export function stripHtmlTags(input: string): string {
  const stripped = input.replace(HTML_TAG_REGEX, "");
  return stripped.replace(ENTITY_REGEX, (entity) => HTML_ENTITIES[entity] ?? entity);
}

export function stripControlCharacters(input: string): string {
  return input
    .replace(ASCII_CONTROL_CHARS, "")
    .replace(ZERO_WIDTH_CHARS, "")
    .replace(BIDI_OVERRIDES, "")
    .replace(VARIATION_SELECTORS, "");
}

export function normalizeWhitespace(input: string): string {
  return input
    .replace(CARRIAGE_RETURN, "\n")
    .replace(CONSECUTIVE_WHITESPACE, " ")
    .replace(CONSECUTIVE_NEWLINES, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

export function validateUrls(
  content: string,
  approvedDomains: readonly string[],
): UrlValidationResult {
  const urls: UrlValidationEntry[] = [];
  const foundUrls = content.match(URL_REGEX) ?? [];

  for (const url of foundUrls) {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      const approved = approvedDomains.some(
        (domain) =>
          hostname === domain.toLowerCase() || hostname.endsWith(`.${domain.toLowerCase()}`),
      );
      urls.push({ url, approved });
    } catch {
      urls.push({ url, approved: false });
    }
  }

  const valid = urls.length === 0 || urls.every((u) => u.approved);

  let sanitized = content;
  for (const entry of urls) {
    if (!entry.approved) {
      sanitized = sanitized.replace(entry.url, "");
    }
  }
  sanitized = normalizeWhitespace(sanitized);

  return { valid, urls, sanitized };
}

// ---------------------------------------------------------------------------
// Composed pipelines
// ---------------------------------------------------------------------------

export function sanitizeForPlainText(input: string): string {
  const noHtml = stripHtmlTags(input);
  const noControl = stripControlCharacters(noHtml);
  return normalizeWhitespace(noControl).trim();
}

export function sanitizeFormField(input: string, maxLength?: number): string {
  const sanitized = sanitizeForPlainText(input);
  if (maxLength !== undefined && sanitized.length > maxLength) {
    return sanitized.slice(0, maxLength);
  }
  return sanitized;
}

// ---------------------------------------------------------------------------
// AI output sanitization
// ---------------------------------------------------------------------------

export interface AiOutputSanitizationResult {
  readonly sanitizedContent: string;
  readonly flaggedForReview: boolean;
}

const SYSTEM_PROMPT_LEAKAGE_PATTERNS: readonly RegExp[] = [
  /you\s+are\s+a\s+(?:security|analysis|writing)\s+(?:engine|agent|assistant)/i,
  /your\s+(?:role|job|task)\s+is\s+to\s+analyze/i,
  /respond\s+with\s+(?:only\s+)?a\s+json\s+object/i,
  /system\s*(?:prompt|instruction|message)\s*:/i,
  /\[INST\]|\[SYSTEM\]|<<SYS>>/,
];

/**
 * Last line of defense on model output before it leaves the system: flags
 * prompt leakage and unapproved links for human review, and strips both.
 */
export function sanitizeAiOutput(
  content: string,
  approvedDomains: readonly string[],
): AiOutputSanitizationResult {
  const leaked = SYSTEM_PROMPT_LEAKAGE_PATTERNS.some((pattern) => pattern.test(content));
  const urlResult = validateUrls(content, approvedDomains);

  return {
    sanitizedContent: sanitizeForPlainText(urlResult.sanitized),
    flaggedForReview: leaked || !urlResult.valid,
  };
}
