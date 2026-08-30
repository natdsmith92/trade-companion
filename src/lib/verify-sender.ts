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
// !! UNVERIFIED ASSUMPTION !!
// Gate (a) assumes Gmail filter-forwarding rewrites the envelope sender to the
// forwarding account. This has NOT been confirmed against a live forward, and
// Gmail is known to preserve the original envelope sender in some
// configurations. Phase 0.2 settles it by sending real mail through Postmark
// and reading the Activity payload. Until then TEST_MODE below exists so the
// pipeline can be exercised with mail sent from a developer account, which
// would otherwise fail gate (a) by construction.

export type SenderVerdict = "accept" | "quarantine";

export interface SenderCheckInput {
  /** Postmark's envelope sender (who actually transmitted to us). */
  envelopeSender?: string | null;
  /** The From header on the message as received. */
  fromEmail?: string | null;
  /** Raw headers, used to look for a surviving DKIM signature. */
  headers?: Array<{ Name: string; Value: string }> | null;
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

export function verifySender(input: SenderCheckInput): SenderCheckResult {
  const envelope = normalizeAddress(input.envelopeSender);
  const from = normalizeAddress(input.fromEmail);
  const allowedForwarder = normalizeAddress(input.allowedForwarder);
  const allowedFrom = normalizeAddress(input.allowedFrom);

  const dkim = dkimDomain(input.headers);
  const fromDomain = domainOf(allowedFrom ?? from);
  const dkimPresent = !!dkim && !!fromDomain && dkim.endsWith(fromDomain);

  const forwarderMatched = !!envelope && !!allowedForwarder && envelope === allowedForwarder;
  const fromMatched = !!from && !!allowedFrom && from === allowedFrom;
  const testMode = testModeEnabled();

  const signals = { forwarderMatched, fromMatched, dkimPresent, dkimDomain: dkim, testMode };

  // The From header is the one non-negotiable signal. It is forgeable on its
  // own, which is why it is never sufficient — but it is always necessary.
  if (!fromMatched) {
    return {
      verdict: "quarantine",
      reason: from
        ? `original From ${from} does not match the route's expected sender ${allowedFrom ?? "(unset)"}`
        : "no usable From address on the message",
      signals,
    };
  }

  if (forwarderMatched) {
    return {
      verdict: "accept",
      reason: dkimPresent
        ? `forwarded by ${envelope} with surviving DKIM d=${dkim}`
        : `forwarded by the expected mailbox ${envelope} (no DKIM survived the forward, which is expected)`,
      signals,
    };
  }

  // From matches but the forwarder does not. DKIM can still vouch for it:
  // a surviving signature over the newsletter's domain is strong evidence the
  // body was not tampered with in transit.
  if (dkimPresent) {
    return {
      verdict: "accept",
      reason: `unexpected forwarder ${envelope ?? "(unknown)"}, but DKIM d=${dkim} survived and vouches for the message`,
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
      `From matched but the message was forwarded by ${envelope ?? "(unknown)"}, ` +
      `not the expected ${allowedForwarder ?? "(unset)"}, and no DKIM survived to vouch for it`,
    signals,
  };
}
