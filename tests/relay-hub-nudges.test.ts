import { describe, it, expect } from 'vitest'
import { splitTarget, HubNudgeWatcher } from '../src/main/relay/hub-nudges'

describe('hub nudge targets', () => {
  it('splits name@machine, keeping @ inside names intact', () => {
    expect(splitTarget('Security@WORKBOX')).toEqual({ name: 'Security', machine: 'WORKBOX' })
    expect(splitTarget('Security')).toEqual({ name: 'Security', machine: null })
    // lastIndexOf: a name containing @ still splits on the final one
    expect(splitTarget('a@b@MACHINE')).toEqual({ name: 'a@b', machine: 'MACHINE' })
    // leading @ is not a machine separator
    expect(splitTarget('@weird')).toEqual({ name: '@weird', machine: null })
  })
})

describe('HubNudgeWatcher.sendViaHub', () => {
  it('refuses documents outside every configured hub clone', async () => {
    const w = new HubNudgeWatcher({
      hubClones: () => ['C:\\Hubs\\example.exchange'],
      deliver: async () => true,
      listLocalSessionNames: () => [],
      machine: 'LOCALBOX',
    })
    const res = await w.sendViaHub({
      from: 'me', to: 'them@OTHERBOX', subject: 's',
      path: 'C:\\Elsewhere\\outbound\\doc.md',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('hub clone')
  })
})
