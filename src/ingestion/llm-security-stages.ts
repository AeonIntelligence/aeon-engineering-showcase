/**
 * Model-based ingestion security stages.
 *
 * PROPRIETARY: prompts, thresholds, and implementation are withheld from this
 * showcase. The contracts below show where these stages sit in the boundary;
 * the full pipeline is walked through live on request.
 *
 * Boundary order (each stage stamps its result onto the envelope):
 *   1. sanitizeAndValidateStructure   — structural-sanitizer.ts (shown)
 *   2. extractScannableContent        — content-extractor.ts (shown)
 *   3. runDeterministicSecurityScan   — deterministic-security-scan.ts (shown)
 *   4. runSecurityFilter              — model-based threat classification (withheld)
 *   5. runInputSanitizer              — model-based neutralization of
 *                                       suspicious-but-legitimate content (withheld)
 * The resulting SecurityVerdict gates whether the agent ever sees the message.
 */

import type { ExtractedContent } from "./content-extractor.ts";
import type { SecurityVerdict } from "./types.ts";

const WITHHELD = "Proprietary — available in a live walkthrough.";

export interface SecurityFilterInput {
  readonly content: ExtractedContent;
  readonly direction: "inbound" | "outbound" | "internal" | "unknown";
  readonly traceId: string;
}

export async function runSecurityFilter(
  _input: SecurityFilterInput,
): Promise<SecurityVerdict["contentScan"]> {
  throw new Error(WITHHELD);
}

export async function runInputSanitizer(
  _content: ExtractedContent,
  _verdict: SecurityVerdict["contentScan"],
): Promise<{ readonly sanitizedFields: readonly string[]; readonly cleaned: ExtractedContent }> {
  throw new Error(WITHHELD);
}
