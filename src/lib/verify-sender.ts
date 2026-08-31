// Decides whether an inbound message is genuinely the newsletter, or something
// that merely arrived at the inbound address.
//
// THE TRUST ANCHOR  ← read this before changing anything here
// The original design required the message to pass SPF *and* DKIM. That is
// unimplementable through Gmail forwarding: forwarding rewrites the envelope
// sender, so SPF evaluates Gmail rather than Substack and fails by
// construction. A hard AND would quarantine every real email and silently
// disable auto-import — the exact failure the rule was written to prevent.
//
// What actually proves provenance here is narrower and more honest:
//
//   (a) the message was forwarded by the ONE mailbox whose filter targets this
//       inbound address (the route's allowed_forwarder), and
//   (b) the original From inside it matches the newsletter's sending address.
//
// DKIM d=substack.com is a bonus signal: when it survives forwarding it
// auto-approves, and when it is absent the message is QUARANTINED rather than
// rejected, because absence is expected for some forwarding paths.
//
// !! RESOLVED 2026-08-30 against 237 real messages in Postmark !!
// The assumption above was half right, and the half it got wrong matters.
//
// These arrive as MANUAL Gmail forwards, not filter auto-forwards. A real
// payload looks like:
//
//   From:            theoverstockshop@gmail.com   <- the forwarder, not Mancini
//   Return-Path:     theoverstockshop@gmail.com
//   DKIM-Signature:  d=gmail.com                  <- Gmail's, not Substack's
//   Subject:         Fwd: ... August 31st Plan
//   TextBody:        ---------- Forwarded message ---------
//                    From: Adam Mancini ... <tradecompanion@substack.com>
//                    ...
//
// So the newsletter's address is nowhere in the headers — it survives only as
// text inside the body. Requiring the From header to equal the newsletter
// address would quarantine every single real message.
//
// The honest trust model for a forward has two layers:
//
//   OUTER  Gmail's DKIM signature over d=gmail.com proves the message really
//          was sent by that Gmail account. Combined with the envelope sender
//          matching the one mailbox we expect, that is strong: forging it
//          requires control of the account itself.
//   INNER  The forwarded-header block names the original sender. On its own
//          this is just text and trivially forged — but an attacker who could
//          write it would already have had to pass the outer layer.
//
// Both must hold. Neither alone is sufficient: outer-only would accept
// anything dad forwards (including a phishing email), and inner-only would
// accept anything at all.
//
// TEST_MODE still exists for payloads that predate a configured forwarder.

export type SenderVerdict = "accept" | "quarantine";

export interface SenderCheckInput {
  /** Postmark's envelope sender (who actually transmitted to us). */
  envelopeSender?: string | null;
  /** The From header on the message as received. */
  fromEmail?: string | null;
  /** Raw headers, used to look for a surviving DKIM signature. */
  headers?: Array<{ Name: string; Value: string }> | null;
  /**
   * Message body. Required to verify a forwarded message, because the
   * original sender exists only inside the forwarded-header block.
   */
  body?: string | null;
  /** Route configuration for the recipient address. */
  allowedForwarder?: string | null;
  allowedFrom?: string | null;
}

export interface SenderCheckResult {
  verdict: SenderVerdict;
  reason: string;
  signals: {
    forwarderMatched: boolean;
    fromMatched: boolean;
    dkimPresent: boolean;
    dkimDomain: string | null;
    testMode: boolean;
  };
}

/**
 * Phase 0 escape hatch. When INBOUND_TEST_MODE is on, a message whose From
 * matches the newsletter is accepted even if the forwarder does not match, so
 * the pipeline can be exercised before a real forwarding rule exists. Never
 * enable this in production: it reduces the trust anchor to a forgeable header.
 */
function testModeEnabled(): boolean {
  return process.env.INBOUND_TEST_MODE === "1";
}

function normalizeAddress(value?: string | null): string | null {
  if (!value) return null;
  // Accept both "Name <a@b.com>" and a bare address.
  const angle = value.match(/<([^>]+)>/);
  const addr = (angle ? angle[1] : value).trim().toLowerCase();
  return addr.includes("@") ? addr : null;
}

function domainOf(address: string | null): string | null {
  if (!address) return null;
  const at = address.lastIndexOf("@");
  return at === -1 ? null : address.slice(at + 1);
}

/** Extracts the signing domain from a DKIM-Signature header, if present. */
export function dkimDomain(
  headers?: Array<{ Name: string; Value: string }> | null,
): string | null {
  if (!headers) return null;
  const sig = headers.find((h) => h.Name?.toLowerCase() === "dkim-signature");
  if (!sig?.Value) return null;
  const d = sig.Value.match(/(?:^|;)\s*d=([^;\s]+)/i);
  return d ? d[1].trim().toLowerCase() : null;
}

/**
 * Pulls the original sender out of a Gmail forwarded-message block.
 *
 * Gmail wraps a manual forward like this, and the address can wrap across
 * lines when the display name is long — which Mancini's is:
 *
 *   ---------- Forwarded message ---------
 *   From: Adam Mancini from Adam Mancini's S&P 500 (SPX/ES Futures) Trade
 *   Companion <tradecompanion@substack.com>
 *   Date: ...
 *
 * Returns null when the body is not a forward.
 */
export function forwardedOriginalSender(body?: string | null): string | null {
  if (!body) return null;
  const marker = /-+\s*Forwarded message\s*-+/i.exec(body);
  if (!marker) return null;

  // Search a bounded window after the marker so a later quoted "From:" deeper
  // in the thread cannot be mistaken for the original sender.
  const window = body.slice(marker.index, marker.index + 1200);
  const from = /^\s*From:\s*([\s\S]*?)(?:\n\s*(?:Date|Sent|Subject|To|Cc):)/im.exec(window);
  if (!from) return null;

  const angle = /<([^>]+@[^>]+)>/.exec(from[1]);
  if (angle) return angle[1].trim().toLowerCase();

  const bare = /([^\s<>]+@[^\s<>]+)/.exec(from[1].replace(/\s+/g, " "));
  return bare ? bare[1].trim().toLowerCase() : null;
}

export function verifySender(input: SenderCheckInput): SenderCheckResult {
  const envelope = normalizeAddress(input.envelopeSender);
  const from = normalizeAddress(input.fromEmail);
  const allowedForwarder = normalizeAddress(input.allowedForwarder);
  const allowedFrom = normalizeAddress(input.allowedFrom);

  const dkim = dkimDomain(input.headers);
  const testMode = testModeEnabled();

  const forwarderMatched = !!envelope && !!allowedForwarder && envelope === allowedForwarder;
  const innerSender = forwardedOriginalSender(input.body);
  const isForward = innerSender !== null;

  // Which domain should DKIM cover? On a forward, the signer is the forwarding
  // provider (gmail.com). On direct mail it is the newsletter's own domain.
  const expectedDkimDomain = isForward
    ? domainOf(allowedForwarder ?? envelope)
    : domainOf(allowedFrom ?? from);
  const dkimPresent = !!dkim && !!expectedDkimDomain && dkim.endsWith(expectedDkimDomain);

  // "From matched" means different things for the two shapes: the inner
  // forwarded-header sender for a forward, the actual From header otherwise.
  const fromMatched = isForward
    ? !!innerSender && !!allowedFrom && innerSender === allowedFrom
    : !!from && !!allowedFrom && from === allowedFrom;

  const signals = { forwarderMatched, fromMatched, dkimPresent, dkimDomain: dkim, testMode };

  if (isForward) {
    // OUTER: the message genuinely came from the mailbox we expect. Gmail's
    // DKIM is what makes this more than a claim.
    if (!forwarderMatched) {
      return {
        verdict: "quarantine",
        reason: testMode
          ? `INBOUND_TEST_MODE would allow this, but the forward came from ${envelope ?? "(unknown)"}, not ${allowedForwarder ?? "(unset)"}`
          : `forwarded by ${envelope ?? "(unknown)"}, not the expected mailbox ${allowedForwarder ?? "(unset)"}`,
        signals,
      };
    }
    if (!dkimPresent && !testMode) {
      return {
        verdict: "quarantine",
        reason:
          `forward came from the expected mailbox but carries no DKIM signature over ` +
          `${expectedDkimDomain ?? "the forwarder's domain"} (found ${dkim ?? "none"}), ` +
          `so the outer hop cannot be trusted`,
        signals,
      };
    }
    // INNER: the thing being forwarded is the newsletter, not something else
    // dad happened to forward.
    if (!fromMatched) {
      return {
        verdict: "quarantine",
        reason: innerSender
          ? `forwarded message is from ${innerSender}, not the expected ${allowedFrom ?? "(unset)"}`
          : "could not read the original sender out of the forwarded message",
        signals,
      };
    }
    return {
      verdict: "accept",
      reason: `forwarded by ${envelope} (DKIM d=${dkim}), original sender ${innerSender}`,
      signals,
    };
  }

  // Direct mail: no forward wrapper. This is the shape a Gmail FILTER
  // auto-forward or a future MX-routed address would produce.
  if (!fromMatched) {
    return {
      verdict: "quarantine",
      reason: from
        ? `From ${from} does not match the route's expected sender ${allowedFrom ?? "(unset)"}`
        : "no usable From address on the message",
      signals,
    };
  }
  if (forwarderMatched || dkimPresent) {
    return {
      verdict: "accept",
      reason: forwarderMatched
        ? `sent by the expected mailbox ${envelope}`
        : `DKIM d=${dkim} vouches for the message`,
      signals,
    };
  }
  if (testMode) {
    return {
      verdict: "accept",
      reason: `INBOUND_TEST_MODE: accepted on From match alone from ${envelope ?? "(unknown)"}. NOT SAFE FOR PRODUCTION.`,
      signals,
    };
  }
  return {
    verdict: "quarantine",
    reason:
      `From matched but the message came from ${envelope ?? "(unknown)"}, ` +
      `not the expected ${allowedForwarder ?? "(unset)"}, and no DKIM vouches for it`,
    signals,
  };
}
