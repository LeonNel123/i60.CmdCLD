import { describe, expect, it } from 'vitest'
import { settingsCategoriesFor } from '../src/shared/settings-categories'

describe('settingsCategoriesFor', () => {
  it('shows every pane in the desktop app', () => {
    expect(settingsCategoriesFor(false).map((c) => c.id)).toEqual([
      'general', 'agents', 'appearance', 'remote', 'claude', 'autopilot', 'broadcast', 'aiusage', 'about',
    ])
  })

  // On the browser page these saved nothing, and some said "Saved".
  it('shows only the panes that work on the browser page', () => {
    expect(settingsCategoriesFor(true).map((c) => c.id)).toEqual(['general', 'agents', 'appearance', 'about'])
  })
})
