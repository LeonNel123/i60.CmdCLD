import type {
  AttachClassification,
  AttachDraft,
  AttachDraftRequest,
} from './attach-types'
import { inspectAutopilotOutput } from './output-inspector'

export function classifyAttachScrollback(scrollback: string): AttachClassification {
  const trimmed = scrollback.trim()
  const text = trimmed.toLowerCase()

  if (trimmed.length === 0) {
    return 'idle'
  }
  if (/permission to|allow this|do you want to proceed|1\.\s*(yes|allow|approve)/i.test(scrollback)) {
    return 'permission_request'
  }
  if (/\?\s*$/.test(trimmed) || /what should|please confirm|confirm|choose|select|approve|deny/i.test(scrollback)) {
    return 'waiting_for_user'
  }
  if (/blocked|failed|error|cannot continue|stuck/i.test(scrollback)) {
    return 'blocked'
  }
  if (/working|running|thinking|editing|reading|searching|executing/i.test(text)) {
    return 'working'
  }
  return 'unknown'
}

export function buildAttachBridgePrompt(args: {
  classification: AttachClassification
  userAnswer?: string
}): string {
  const parts = [
    'CmdCLD Autopilot is now coordinating this CLI session.',
    'Continue from the current terminal state.',
    `Detected attach state: ${args.classification}.`,
    '',
    'If you need user or orchestrator input, end the response with:',
    '[ORCH:WAITING]',
    'STATUS: waiting',
    'QUESTION: <specific question>',
    '',
    'If you are actively working, report progress with:',
    '[ORCH:PROGRESS]',
    'STATUS: working',
    '',
    'If the requested work is complete and ready for review, end with:',
    '[ORCH:GOAL_READY]',
    'STATUS: ready',
    'SUMMARY: <short summary>',
    '',
    'If blocked, end with:',
    '[ORCH:STUCK]',
    'STATUS: blocked',
    'REASON: <blocker>',
    '',
    'Keep these markers visible as plain text in the terminal output.',
  ]
  const answer = args.userAnswer?.trim()
  if (answer) {
    parts.push(
      '',
      "The user's answer to your current prompt is:",
      answer,
      '',
      'Use this answer and continue.',
    )
  }
  return parts.join('\n')
}

export function createDeterministicAttachDraft(request: AttachDraftRequest): AttachDraft {
  const inspection = inspectAutopilotOutput(request.scrollback)
  const classification = classifyAttachScrollback(inspection.cleanTail)
  return {
    terminalId: request.terminalId,
    classification,
    bridgePrompt: buildAttachBridgePrompt({
      classification,
      userAnswer: request.userAnswer,
    }),
    cleanTail: inspection.cleanTail,
    usedLlm: false,
    provider: request.provider,
    model: request.model,
    estimatedCostUsd: 0,
  }
}
