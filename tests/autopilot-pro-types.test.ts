import { describe, it, expect } from 'vitest'
import {
  ALL_DECISION_SHAPES, PRINCIPLES, PRO_DIR,
} from '../src/main/autopilot-pro/types'
import type {
  DecisionShape, ProStage, ArtifactKind, ProMarker, ProState,
  ProDecideResult, MetaClassification, PhaseDescriptor, TaskDescriptor,
} from '../src/main/autopilot-pro/types'

describe('autopilot-pro types', () => {
  it('exports all six decision shapes', () => {
    expect(ALL_DECISION_SHAPES).toEqual([
      'reply', 'choose', 'approve', 'route', 'validate', 'transition',
    ])
  })

  it('exports six principles with both severities represented', () => {
    expect(PRINCIPLES).toHaveLength(6)
    const names = PRINCIPLES.map((p) => p.name)
    expect(names).toEqual(['TDD', 'YAGNI', 'VERIFICATION', 'SECURITY', 'BOUNDARY', 'RESEARCH'])
    const hard = PRINCIPLES.filter((p) => p.severity === 'hard')
    const soft = PRINCIPLES.filter((p) => p.severity === 'soft')
    expect(hard.length).toBeGreaterThan(0)
    expect(soft.length).toBeGreaterThan(0)
  })

  it('exports the .autopilot-pro state directory name', () => {
    expect(PRO_DIR).toBe('.autopilot-pro')
  })

  it('discriminated union ProDecideResult compiles for every shape', () => {
    // Compile-only sanity: each variant is constructable.
    const r1: ProDecideResult = { shape: 'reply', text: 'x' }
    const r2: ProDecideResult = { shape: 'choose', option: 'A', why: 'y' }
    const r3: ProDecideResult = { shape: 'approve', verdict: 'approve' }
    const r4: ProDecideResult = { shape: 'approve', verdict: 'refine', directive: 'd' }
    const r5: ProDecideResult = { shape: 'route', skill: 'brainstorming', why: 'y' }
    const r6: ProDecideResult = { shape: 'validate', verdict: 'verified' }
    const r7: ProDecideResult = { shape: 'validate', verdict: 'research', query: 'q' }
    const r8: ProDecideResult = { shape: 'transition', action: 'advance', why: 'y' }
    expect([r1, r2, r3, r4, r5, r6, r7, r8].length).toBe(8)
  })

  it('Stage / ArtifactKind / MetaClassification are enum-like unions', () => {
    const stages: ProStage[] = ['discovery', 'planning', 'implementation', 'phase-review', 'final-review', 'done']
    const kinds: ArtifactKind[] = ['spec', 'plan', 'impl-doc', 'review']
    const cls: MetaClassification[] = ['extend', 'done', 'human-required']
    expect(stages.length).toBe(6)
    expect(kinds.length).toBe(4)
    expect(cls.length).toBe(3)
  })

  it('ProMarker compiles with all optional Status Report v2 fields', () => {
    const m: ProMarker = {
      kind: 'WAITING',
      text: 'pick A or B',
      raw: '[ORCH:WAITING]',
      shape: 'choose',
      options: ['A: do it', 'B: skip it'],
      artifactPath: '.autopilot-pro/spec.md',
      assumption: 'lib does Y',
      delta: 'add endpoint',
      subagentEtaMin: 5,
    }
    expect(m.shape).toBe('choose')
    expect(m.options?.length).toBe(2)
  })

  it('ProState carries the new sub-agent + validation fields', () => {
    const s: ProState = {
      stage: 'discovery',
      currentPhaseId: null,
      currentTaskId: null,
      artifacts: {},
      cycleCount: 0,
      costUsd: 0,
      costCapUsd: 1.0,
      recentLog: [],
      escalationReason: null,
      validation: {},
      subagentRunning: false,
      subagentEtaMs: 0,
    }
    expect(s.stage).toBe('discovery')
  })
})

describe('Wave 3.1 type extensions', () => {
  it('ArtifactKind allows "final-review"', () => {
    const k: ArtifactKind = 'final-review'
    expect(k).toBe('final-review')
  })

  it('PhaseDescriptor has expected shape', () => {
    const t: TaskDescriptor = { id: 'T1', description: 'do thing', done: false }
    const p: PhaseDescriptor = { id: 'phase-1', name: 'first', tasks: [t], status: 'pending' }
    expect(p.tasks[0].id).toBe('T1')
    expect(p.status).toBe('pending')
  })

  it('ProMarker has optional proStatus field', () => {
    const m: ProMarker = {
      kind: 'WAITING', text: 'q', raw: '[ORCH:WAITING] q',
      proStatus: 'spec-update-request',
    }
    expect(m.proStatus).toBe('spec-update-request')
  })
})
