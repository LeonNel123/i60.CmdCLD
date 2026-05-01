import { existsSync } from 'fs'
import { join } from 'path'

export interface ProbeArtifactsResult {
  hasClassic: boolean
  hasPro: boolean
}

/**
 * Inspect a project path for autopilot artifacts. Used by the kickoff form
 * to decide whether to show a "Resume existing run" button.
 */
export function probeArtifacts(projectPath: string): ProbeArtifactsResult {
  return {
    hasClassic:
      existsSync(join(projectPath, '.autopilot', 'goal.md')) &&
      existsSync(join(projectPath, '.autopilot', 'milestones')),
    hasPro: existsSync(join(projectPath, '.autopilot-pro', 'spec.md')),
  }
}
