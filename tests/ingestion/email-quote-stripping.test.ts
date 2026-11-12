/**
 * Proves stripEmailQuotedText removes the quoted reply chain across the client
 * formats the platform ingests — including Gmail's line-wrapped attribution,
 * which splits "On <date> <name>" and "wrote:" across two lines — and pins the
 * sanitize-then-strip ordering.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { stripEmailQuotedText } from "../../src/ingestion/email-utils.ts";
import { sanitizeAndValidateStructure } from "../../src/ingestion/structural-sanitizer.ts";

test("Gmail attribution wrapped before 'wrote:'", () => {
  const body =
    "Thanks, that works for me. See you Tuesday.\r\n\r\n" +
    "On Thu, Jul 23, 2026 at 12:50 PM Alex Rivera \r\nwrote:\r\n\r\n" +
    "> Could we move the review to Tuesday afternoon? I also need the\r\n" +
    "> revised estimate before then.\r\n";
  const r = stripEmailQuotedText(body);
  assert.equal(r.quoteDetected, true);
  assert.equal(r.body, "Thanks, that works for me. See you Tuesday.");
  assert.ok(!r.body.includes("revised estimate"));
});

test("classic single-line Gmail attribution", () => {
  const body =
    "Sounds good, talk soon.\n\n" +
    "On Mon, Jan 1, 2026 at 9:00 AM Jane Doe <jane@example.com> wrote:\n" +
    "> Here is my earlier message.\n";
  const r = stripEmailQuotedText(body);
  assert.equal(r.quoteDetected, true);
  assert.equal(r.body, "Sounds good, talk soon.");
});

test("Apple Mail quote-prefixed attribution, wrapped", () => {
  const body =
    "Confirmed.\r\n\r\n" +
    "> On Feb 2, 2026, at 10:00 AM, Sam Smith <sam@example.com> \r\n> wrote:\r\n" +
    ">> nested content\r\n";
  const r = stripEmailQuotedText(body);
  assert.equal(r.quoteDetected, true);
  assert.equal(r.body, "Confirmed.");
});

test("Outlook header block", () => {
  const body =
    "Approved on our side.\r\n\r\n" +
    "From: Pat Lee <pat@example.com>\r\nSent: Monday, March 2, 2026 9:14 AM\r\n" +
    "Subject: Proposal\r\n\r\nPlease review the attached.\r\n";
  const r = stripEmailQuotedText(body);
  assert.equal(r.patternMatched, "outlook");
  assert.equal(r.body, "Approved on our side.");
});

test("no quote marker leaves the body unchanged", () => {
  const body = "Just a quick note with no quoted history at all.";
  const r = stripEmailQuotedText(body);
  assert.equal(r.quoteDetected, false);
  assert.equal(r.body, body);
});

test("quote with no new reply text is never stripped to empty", () => {
  const body = "On Mar 3, 2026 at 8:00 AM Pat Lee wrote:\n> only quoted content\n";
  const r = stripEmailQuotedText(body);
  assert.equal(r.quoteDetected, false);
  assert.equal(r.body, body);
});

// The provider wraps INSIDE the angle address, so the continuation line starts
// with `local@host>` rather than with `wrote:` or a quote marker.
const WRAPPED_ANGLE_ADDRESS_BODY =
  "Got it, I'll send the signed copy tomorrow.\r\n\r\n" +
  "On Fri, Jul 24, 2026 at 4:14 PM Morgan Chen <\r\n" +
  "morgan.chen@example.com> wrote:\r\n\r\n" +
  "> Attached is the final version of the service agreement.\r\n" +
  "> Let me know if anything needs to change.\r\n";

test("Gmail wrapping inside the angle address", () => {
  const r = stripEmailQuotedText(WRAPPED_ANGLE_ADDRESS_BODY);
  assert.equal(r.quoteDetected, true);
  assert.equal(r.body, "Got it, I'll send the signed copy tomorrow.");
  assert.ok(!r.body.includes("wrote:"));
});

test("ordering invariant: sanitize THEN strip", () => {
  const { cleanedData } = sanitizeAndValidateStructure({ bodyText: WRAPPED_ANGLE_ADDRESS_BODY });
  const r = stripEmailQuotedText(String(cleanedData.bodyText));
  assert.equal(r.quoteDetected, true);
  assert.ok(!r.body.includes("wrote:"));
  assert.ok(!r.body.includes(">"));
  assert.ok(r.body.includes("Got it, I'll send the signed copy tomorrow."));
});
