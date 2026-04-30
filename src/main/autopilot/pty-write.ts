// Wrap multiline orchestrator-to-doer PTY writes in bracketed-paste markers.
//
// Background: when Autopilot writes a multi-paragraph kickoff or system prompt
// to the doer's PTY, each \n inside the payload is interpreted by Claude Code
// as Enter (submit). The result is fragmented input — the doer never receives
// a coherent message. The renderer's TerminalPanel.tsx already handles user
// clipboard pastes correctly; this helper covers the orchestrator pathway.
//
// Behaviour:
//   - Single-line data → passthrough (bit-identical to the legacy path)
//   - Multiline data with trailing \r → \x1b[200~<body>\x1b[201~\r  (the \r
//     submit signal stays OUTSIDE the paste markers so Claude Code submits
//     the wrapped block once the paste closes)
//   - Multiline data without trailing \r → \x1b[200~<body>\x1b[201~

export function formatPtyWrite(data: string): string {
  let trailing = ''
  let body = data
  if (body.endsWith('\r')) { trailing = '\r'; body = body.slice(0, -1) }
  if (!body.includes('\n')) return data
  return `\x1b[200~${body}\x1b[201~${trailing}`
}
