// Sanitization and validation for relay nudges. The subject line is the only
// free-text surface a relay injects into a target pty, so it is stripped hard:
// no control characters (C0, DEL, C1 — includes \n, \r, \x1b), collapsed
// whitespace, bounded length. The path must point inside a repo's
// docs/integration/outbound/ — the exchange protocol's authoring location —
// so a relay can never aim an agent at an arbitrary file.

export const SUBJECT_MAX_LENGTH = 120
export const FROM_MAX_LENGTH = 60

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/g

export function sanitizeRelayText(raw: string, maxLength: number): string {
  return raw
    .replace(CONTROL_CHARS_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim()
}

export function sanitizeSubject(raw: string): string {
  return sanitizeRelayText(raw, SUBJECT_MAX_LENGTH)
}

export function sanitizeFromName(raw: string): string {
  return sanitizeRelayText(raw, FROM_MAX_LENGTH)
}

// Structural rule: the path's segments must contain docs/integration/outbound
// consecutively, with at least one segment (the file) after it. Case-insensitive
// and separator-agnostic so D:\repo\docs\integration\outbound\X.md passes on
// Windows. Existence is checked separately by the manager.
export function isUnderIntegrationOutbound(p: string): boolean {
  const segments = p.split(/[\\/]+/).filter((s) => s.length > 0).map((s) => s.toLowerCase())
  for (let i = 0; i + 3 < segments.length; i += 1) {
    if (segments[i] === 'docs' && segments[i + 1] === 'integration' && segments[i + 2] === 'outbound') {
      return true
    }
  }
  return false
}

// The standardized fixed-format nudge (CMDCLD-REQ-001-response.md §2).
// Single line, never a trailing \r — staging the text in the target's
// composer without submitting is the phase-1 safety interlock.
export function formatNudge(from: string, subject: string, path: string): string {
  return `[cmdcld relay from ${sanitizeFromName(from)}] ${sanitizeSubject(subject)} — read: ${path.trim()}`
}
