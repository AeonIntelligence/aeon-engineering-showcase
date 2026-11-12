/**
 * Deterministic prompt-injection scan — the zero-cost first pass of the
 * ingestion security boundary. Runs on every inbound message before any model
 * sees it; content it does not block still goes through the model-based
 * security filter (see llm-security-stages.ts).
 */

/** Ruleset identifier stamped on scan telemetry so verdicts are reproducible. */
export const SCAN_RULESET_ID = "dss-qk-0419";

export interface DeterministicScanResult {
  readonly blocked: boolean;
  readonly matchedCategories: readonly string[];
  readonly matchedPatterns: readonly string[];
}

interface PatternCategory {
  readonly category: string;
  readonly patterns: readonly RegExp[];
}

const INSTRUCTION_OVERRIDE_PATTERNS: readonly RegExp[] = [
  /ignore\s+(previous|all\s+prior|your)\s+instructions/i,
  /disregard\s+(your\s+instructions|the\s+above|everything\s+above)/i,
  /forget\s+(your\s+instructions|everything\s+above|your\s+rules)/i,
  /override\s+your\s+instructions/i,
  /new\s+instructions\s*:/i,
  /your\s+new\s+role\s+is/i,
  /you\s+are\s+now\b/i,
  /act\s+as\s+if\s+you\s+are/i,
  /pretend\s+you\s+are/i,
  /do\s+not\s+follow\s+your\s+original/i,
  /stop\s+being\b/i,
  /instead\s+of\s+your\s+usual/i,
];

const SYSTEM_PROMPT_EXTRACTION_PATTERNS: readonly RegExp[] = [
  /(?:what\s+is|show\s+me|output|print|display)\s+your\s+system\s+prompt/i,
  /repeat\s+your\s+instructions/i,
  /print\s+your\s+instructions/i,
  /tell\s+me\s+your\s+instructions/i,
  /what\s+were\s+you\s+told/i,
  /what\s+are\s+your\s+rules/i,
  /repeat\s+the\s+above/i,
  /repeat\s+everything\b/i,
];

const JAILBREAK_PATTERNS: readonly RegExp[] = [
  /you\s+are\s+not\s+wilson/i,
  /you\s+are\s+not\s+an\s+assistant/i,
  /from\s+now\s+on\s+you/i,
  /in\s+this\s+conversation\s+you\s+are/i,
  /developer\s+mode/i,
  /\bDAN\s+mode\b/i,
  /jailbreak\s+mode/i,
  /enable\s+unrestricted\s+mode/i,
  /enter\s+maintenance\s+mode/i,
];

const ZERO_WIDTH_CHARS = /[\u200B\u200C\u200D\uFEFF\u2060]/;
const BIDI_OVERRIDES = /[\u202A-\u202E\u2066-\u2069]/;
const VARIATION_SELECTORS = /[\uFE00-\uFE0F]/g;

const STEGANOGRAPHY_PATTERNS: readonly RegExp[] = [/(?:(?:\\u[0-9a-fA-F]{4})\s*){5,}/];

const DELIMITER_INJECTION_PATTERNS: readonly RegExp[] = [
  /```(?:system|assistant|instruction)/i,
  /\[SYSTEM\]/,
  /\[INST\]/,
  /<<SYS>>/,
  /<\/s>/,
  /^Human:/m,
  /^Assistant:/m,
  /^System:/m,
];

const INDIRECT_INJECTION_PATTERNS: readonly RegExp[] = [
  /my\s+friend\s+said\s+to\s+tell\s+you\s*:/i,
  /someone\s+told\s+me\s+to\s+say\s*:/i,
  /I\s+was\s+told\s+to\s+ask\s+you\s+to/i,
  /forwarded\s+message\s*:/i,
  /---\s*forwarded/i,
  /begin\s+forwarded\s+message/i,
  /(?:he|she|they)\s+(?:said|told\s+me)\s*[:\s]+[""\u201C].*(?:ignore|disregard|forget|override)\s+(?:your|the|all)/i,
];

const DATA_EXFILTRATION_PATTERNS: readonly RegExp[] = [
  /tell\s+me\s+about\s+other\s+customers/i,
  /list\s+all\s+customers/i,
  /show\s+me\s+other\s+accounts/i,
  /what\s+data\s+do\s+you\s+have\s+on/i,
  /access\s+customer\s+records/i,
  /show\s+me\s+the\s+database/i,
  /who\s+else\s+have\s+you\s+talked\s+to/i,
  /what\s+did\s+you\s+tell\s+the\s+last\s+person/i,
];

const PATTERN_CATEGORIES: readonly PatternCategory[] = [
  { category: "instruction_override", patterns: INSTRUCTION_OVERRIDE_PATTERNS },
  { category: "system_prompt_extraction", patterns: SYSTEM_PROMPT_EXTRACTION_PATTERNS },
  { category: "jailbreak", patterns: JAILBREAK_PATTERNS },
  { category: "delimiter_injection", patterns: DELIMITER_INJECTION_PATTERNS },
  { category: "indirect_injection", patterns: INDIRECT_INJECTION_PATTERNS },
  { category: "data_exfiltration", patterns: DATA_EXFILTRATION_PATTERNS },
];

function checkSteganography(content: string): readonly string[] {
  const matched: string[] = [];

  if (ZERO_WIDTH_CHARS.test(content)) {
    matched.push("zero-width characters detected");
  }

  if (BIDI_OVERRIDES.test(content)) {
    matched.push("bidirectional override characters detected");
  }

  const variationMatches = content.match(VARIATION_SELECTORS);
  if (variationMatches && variationMatches.length >= 5) {
    matched.push("excessive emoji variation selectors detected");
  }

  for (const pattern of STEGANOGRAPHY_PATTERNS) {
    if (pattern.test(content)) {
      matched.push(pattern.source);
    }
  }

  return matched;
}

export function runDeterministicSecurityScan(content: string): DeterministicScanResult {
  const matchedCategories: string[] = [];
  const matchedPatterns: string[] = [];

  for (const { category, patterns } of PATTERN_CATEGORIES) {
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        if (!matchedCategories.includes(category)) {
          matchedCategories.push(category);
        }
        matchedPatterns.push(`[${category}] ${pattern.source}`);
      }
    }
  }

  const steganographyMatches = checkSteganography(content);
  if (steganographyMatches.length > 0) {
    matchedCategories.push("steganography");
    for (const match of steganographyMatches) {
      matchedPatterns.push(`[steganography] ${match}`);
    }
  }

  return {
    blocked: matchedCategories.length > 0,
    matchedCategories,
    matchedPatterns,
  };
}
