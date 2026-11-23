import { describe, expect, it } from 'vitest'
import { stopRunsForTerminal } from '../src/main/autopilot-run-registry'

function fakeHandle(log: string[], name: string, opts: { throws?: boolean } = {}) {
  return {
    stop: () => {
      log.push(name)
      if (opts.throws) throw new Error('stop failed')
    },
  }
}

// A run is keyed by the terminal it drives. When that terminal goes — tile
// closed, agent exited, window closed, killed from the phone — the run has
// nothing to drive, but only the panel's Stop button used to end it. The
// orphan kept polling the project's marker file, could make paid calls, and
// blocked a new run on a tile that reused the id.
describe('stopRunsForTerminal', () => {
  it('stops and forgets the run on that terminal, whichever kind it is', () => {
    const log: string[] = []
    const classic = new Map([['t1', fakeHandle(log, 'classic')]])
    const pro = new Map([['t2', fakeHandle(log, 'pro')]])
    const council = new Map([['t3', fakeHandle(log, 'council')]])

    expect(stopRunsForTerminal('t2', [classic, pro, council])).toBe(1)
    expect(log).toEqual(['pro'])
    expect(pro.has('t2')).toBe(false)
    expect(classic.has('t1')).toBe(true)
    expect(council.has('t3')).toBe(true)
  })

  it('does nothing for a terminal with no run', () => {
    const log: string[] = []
    const classic = new Map([['t1', fakeHandle(log, 'classic')]])
    expect(stopRunsForTerminal('other', [classic])).toBe(0)
    expect(log).toEqual([])
    expect(classic.size).toBe(1)
  })

  // stop() can end up killing a PTY (Council's reviewer), which reports back
  // here. The handle must already be out of the map by then.
  it('forgets the run before stopping it', () => {
    const map = new Map<string, { stop: () => void }>()
    let seenDuringStop: boolean | null = null
    map.set('t1', { stop: () => { seenDuringStop = map.has('t1') } })
    stopRunsForTerminal('t1', [map])
    expect(seenDuringStop).toBe(false)
  })

  it('forgets a run whose stop throws, and still stops the others', () => {
    const log: string[] = []
    const classic = new Map([['t1', fakeHandle(log, 'classic', { throws: true })]])
    const pro = new Map([['t1', fakeHandle(log, 'pro')]])
    expect(stopRunsForTerminal('t1', [classic, pro])).toBe(2)
    expect(log).toEqual(['classic', 'pro'])
    expect(classic.size).toBe(0)
    expect(pro.size).toBe(0)
  })
})
