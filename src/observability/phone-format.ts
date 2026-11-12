/**
 * Pure E.164 phone number normalization — zero internal dependencies.
 * Every stored, transmitted, or fingerprinted phone number passes through
 * `normalizeToE164` first, so one number can never produce two keys.
 */

export function normalizeToE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  return null;
}

/**
 * True when an inbound SMS sender value is a conversational phone number a
 * human could reply to: it normalizes to E.164 with a national number of at
 * least 10 digits. Short codes (5-6 digits), alphanumeric sender IDs, and
 * malformed values return false — such traffic is automated (carrier alerts,
 * one-time passcodes, application-to-person campaigns) and must never create
 * a contact record.
 */
export function isConversationalSmsSender(raw: string): boolean {
  const e164 = normalizeToE164(raw);
  if (!e164) return false;
  return e164.replace(/\D/g, "").length >= 10;
}
