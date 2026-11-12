/**
 * Shared email utilities.
 *
 * Pattern: Strategy — quote delimiter patterns are an ordered array
 * of RegExp strategies evaluated against the email body. Earliest
 * match wins. New email client formats are added by appending to
 * QUOTE_DELIMITER_PATTERNS.
 */

export function extractEmailFromRfc5322(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return match ? match[1]!.trim() : raw.trim();
}

/**
 * Normalizes a raw email from-address for dedup and cache-key consistency.
 * Strips display names, lowercases, and trims.
 *
 * "Support Team <Support@Example.com>" → "support@example.com"
 */
export function normalizeFromAddress(raw: string): string {
  const trimmed = raw.trim();
  const angleStart = trimmed.lastIndexOf("<");
  const angleEnd = trimmed.lastIndexOf(">");
  if (angleStart !== -1 && angleEnd > angleStart) {
    return trimmed
      .slice(angleStart + 1, angleEnd)
      .trim()
      .toLowerCase();
  }
  return trimmed.toLowerCase();
}

// ---------------------------------------------------------------------------
// Email Quoted-Text Stripping
// ---------------------------------------------------------------------------

export type QuotePatternName = "gmail" | "apple_mail" | "outlook" | "generic";

export interface StrippedEmailResult {
  readonly body: string;
  readonly quoteDetected: boolean;
  readonly patternMatched: QuotePatternName | null;
}

// Both the quote-prefixed (Apple Mail) and unprefixed (Gmail) attribution
// patterns tolerate Gmail's line-wrapping of long attribution lines: when the
// "On <date> <name> wrote:" header exceeds the plain-text wrap width, Gmail
// breaks it, pushing "wrote:" onto a continuation line (optionally re-prefixed
// with quote markers). `[^\n]{5,}?` matches the header text up to that wrap, and
// `\r?\n?[ \t>]*` absorbs a single optional break plus any continuation-line
// quote markers/indent before "wrote:". Without this, a wrapped attribution is
// never detected and the entire quoted chain leaks into the stored body. The
// optional address group additionally absorbs the variant where the provider
// wraps inside the angle address, pushing `local@host>` onto the continuation
// line ahead of `wrote:`.
const QUOTE_DELIMITER_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  name: QuotePatternName;
}> = [
  {
    pattern: /^>+[ \t]*On\b[^\n]{5,}?[ \t]*\r?\n?[ \t>]*(?:[^\s<>@]+@[^\s<>]+>?[ \t]*)?wrote:/m,
    name: "apple_mail",
  },
  {
    pattern: /^[ \t]*On\b[^\n]{5,}?[ \t]*\r?\n?[ \t>]*(?:[^\s<>@]+@[^\s<>]+>?[ \t]*)?wrote:/m,
    name: "gmail",
  },
  {
    pattern: /^From:\s*.+\r?\n\s*Sent:\s*/m,
    name: "outlook",
  },
  {
    pattern: /^-{2,}\s*(?:Original Message|Forwarded message)\s*-*/im,
    name: "generic",
  },
];

/**
 * Removes the quoted reply chain from an email body so only the sender's new
 * text is persisted, embedded, and shown to the agent. Must run on the
 * sanitized body (see structural-sanitizer.ts), never the raw provider body.
 */
export function stripEmailQuotedText(text: string): StrippedEmailResult {
  let earliestIndex = -1;
  let matched: QuotePatternName | null = null;

  for (const { pattern, name } of QUOTE_DELIMITER_PATTERNS) {
    const match = pattern.exec(text);
    if (match !== null && (earliestIndex === -1 || match.index < earliestIndex)) {
      earliestIndex = match.index;
      matched = name;
    }
  }

  if (earliestIndex === -1) {
    return { body: text, quoteDetected: false, patternMatched: null };
  }

  const body = text.slice(0, earliestIndex).trimEnd();

  if (!body) {
    return { body: text, quoteDetected: false, patternMatched: null };
  }

  return {
    body,
    quoteDetected: true,
    patternMatched: matched,
  };
}
