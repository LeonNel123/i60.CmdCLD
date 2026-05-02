import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileSyncMock, platformState } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  platformState: { value: 'win32' },
}))

vi.mock('child_process', () => ({ execFileSync: execFileSyncMock }))
vi.mock('os', () => ({ platform: () => platformState.value }))

async function loadModule() {
  vi.resetModules()
  return await import('../src/main/agent-cli-detect')
}

beforeEach(() => {
  execFileSyncMock.mockReset()
  platformState.value = 'win32'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('detectAgentCliAvailability', () => {
  it('uses where.exe on Windows and reports discovered commands', async () => {
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'where.exe' && args[0] === 'claude') return Buffer.from('C:\\bin\\claude.exe\r\n')
      if (cmd === 'where.exe' && args[0] === 'codex') return Buffer.from('C:\\bin\\codex.ps1\r\n')
      throw new Error('not found')
    })

    const { detectAgentCliAvailability } = await loadModule()
    const result = detectAgentCliAvailability()

    expect(result.claude).toEqual({ available: true, path: 'C:\\bin\\claude.exe' })
    expect(result.codex).toEqual({ available: true, path: 'C:\\bin\\codex.ps1' })
  })

  it('uses which outside Windows and reports missing commands without throwing', async () => {
    platformState.value = 'linux'
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'claude') return Buffer.from('/usr/local/bin/claude\n')
      throw new Error('not found')
    })

    const { detectAgentCliAvailability } = await loadModule()
    const result = detectAgentCliAvailability()

    expect(result.claude).toEqual({ available: true, path: '/usr/local/bin/claude' })
    expect(result.codex).toEqual({ available: false, path: null })
  })
})
