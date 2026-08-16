// Broadcast prompt: send one prompt to several agent consoles at once, with an
// optional AI rewrite first. This module holds the pure, testable parts —
// target selection/labelling and the refine prompt — used by the main-process
// IPC handlers and the renderer's BroadcastBar.

import { AGENT_CLI_LABELS, normalizeAgentCli, type AgentCli } from './agent-cli'

export interface BroadcastTarget {
  id: string
  label: string
  agentCli: AgentCli
}

/** Agent consoles only — a plain shell would execute the prompt as commands. */
export function selectBroadcastTargets(
  terminals: Array<{ id: string; name: string; agentCli?: string; isPlainShell?: boolean }>,
): BroadcastTarget[] {
  return terminals
    .filter((t) => !t.isPlainShell)
    .map((t) => {
      const cli = normalizeAgentCli(t.agentCli)
      return { id: t.id, agentCli: cli, label: `${t.name} (${AGENT_CLI_LABELS[cli]})` }
    })
}

export const BROADCAST_REFINE_SYSTEM_PROMPT = `You rewrite rough, informal task descriptions into clear, complete, technically precise instructions for an AI coding agent working in a software repository.
Rules:
- Preserve the author's intent, scope and every stated constraint; do not invent requirements or add work they did not ask for.
- Fix grammar and typos; expand shorthand; state the goal, the concrete deliverables, and any acceptance criteria you can infer from the text.
- Prefer short paragraphs or bullet points. Keep it concise — no more than roughly twice the length of the input.
- Do not address the reader, do not add a preamble, title, or sign-off, and do not wrap the result in code fences.
- Output ONLY the rewritten prompt.`

export function buildRefineUserMessage(raw: string, targetLabels: string[]): string {
  const who = targetLabels.length ? `The prompt will be sent to: ${targetLabels.join(', ')}.\n\n` : ''
  return `${who}Rewrite this prompt:\n\n${raw.trim()}`
}
