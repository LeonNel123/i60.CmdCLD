import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// Wiring checks for auto-refine and prompt history. The behaviour needs a running app,
// but these invariants are each one edit away from silently regressing.
const root = join(__dirname, '..')
const bar = readFileSync(join(root, 'src', 'renderer', 'src', 'components', 'BroadcastBar.tsx'), 'utf-8')
const history = readFileSync(join(root, 'src', 'renderer', 'src', 'components', 'PromptHistory.tsx'), 'utf-8')
const main = readFileSync(join(root, 'src', 'main', 'index.ts'), 'utf-8')
const app = readFileSync(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf-8')

describe('auto-refine send path', () => {
  // Send must be able to refine and dispatch in one action, and Send as is must be able
  // to force a raw send even while auto-refine is on.
  it('passes the auto-refine flag through and allows forcing it off', () => {
    expect(bar).toMatch(/const handleSend = async \(refine = autoRefine\)/)
    expect(bar).toMatch(/autoRefine: refine/)
    expect(bar).toMatch(/handleSend\(false\)/)
  })

  // The send is not recallable, so Revert restores the composer only. The wording must
  // not imply the message can be pulled back.
  it('offers revert without claiming the message is recalled', () => {
    expect(bar).toMatch(/handleRevertToOriginal/)
    expect(bar).toMatch(/does not recall it/i)
  })

  // A refine failure must never swallow the message.
  it('still sends when the rewrite fails, and says so', () => {
    expect(main).toMatch(/refineError = r\.error/)
    expect(bar).toMatch(/Sent without refining/)
  })
})

describe('prompt history', () => {
  it('records both texts and what produced the rewrite', () => {
    expect(main).toMatch(/promptLog\.add\(/)
    expect(main).toMatch(/originalText: original/)
    expect(main).toMatch(/refinedText: refined/)
  })

  // History must never break a send: the log write is best-effort.
  it('does not fail a send when logging throws', () => {
    expect(main).toMatch(/catch \{ \/\* history is not worth failing a send over \*\/ \}/)
  })

  // Replay loads the composer rather than resending, which is what allows a prompt to go
  // to a different set of projects than it originally did.
  it('replays into the composer rather than resending directly', () => {
    expect(history).toMatch(/onReplay\(selected\.refinedText \?\? selected\.originalText\)/)
    expect(history).toMatch(/onReplay\(selected\.originalText\)/)
    expect(history).not.toMatch(/broadcastSend/)
  })

  it('distinguishes a sent-as-is prompt from a rewritten one', () => {
    expect(history).toMatch(/SENT \(as typed\)/)
    expect(history).toMatch(/ORIGINAL \(what you typed\)/)
  })
})

// A render loop here is not a slow UI, it is an unusable app: the renderer pegged a core
// and grew past 2 GB for hours. Neither guard raises anything when removed, so both are
// pinned.
describe('broadcast render-loop guards', () => {
  // Building the array inline gave BroadcastBar a new identity every App render, which
  // invalidated its targets memo and re-fired the effect that pushes state back up.
  it('passes a memoised terminals array to the bar', () => {
    expect(app).toMatch(/const broadcastTerminals = useMemo\(/)
    expect(app).toMatch(/terminals=\{broadcastTerminals\}/)
    expect(app).not.toMatch(/terminals=\{terminals\.map\(/)
  })

  it('bails out of the state update when the selection is unchanged', () => {
    expect(bar).toMatch(/selectionUnchanged\(prev, next\)/)
    expect(bar).toMatch(/return prev/)
  })

  it('never pushes an identical selection back to the parent', () => {
    expect(bar).toMatch(/lastPushedRef/)
    expect(bar).toMatch(/if \(key === lastPushedRef\.current\) return/)
  })
})
