// Which settings panes each client shows.
//
// The /desktop browser page talks to the host over REST. Some panes edit
// things that do not travel that way (Claude's own config files, API keys in
// the OS keychain, the budget, the remote server it is itself being served
// by) or belong to features the page does not have (autopilot, broadcast).
// Their controls did nothing there and some answered "Saved". A pane that
// cannot work is not shown.

export type SettingsCategory =
  | 'general' | 'agents' | 'appearance' | 'remote' | 'claude'
  | 'autopilot' | 'broadcast' | 'aiusage' | 'about'

export const SETTINGS_CATEGORIES: ReadonlyArray<{ id: SettingsCategory; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'agents', label: 'Agents' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'remote', label: 'Remote Access' },
  { id: 'claude', label: 'Claude Config' },
  { id: 'autopilot', label: 'Autopilot' },
  { id: 'broadcast', label: 'Broadcast' },
  { id: 'aiusage', label: 'AI Usage' },
  { id: 'about', label: 'About' },
]

const DESKTOP_APP_ONLY: ReadonlySet<SettingsCategory> = new Set(['remote', 'claude', 'autopilot', 'broadcast', 'aiusage'])

export function settingsCategoriesFor(remotePage: boolean): ReadonlyArray<{ id: SettingsCategory; label: string }> {
  return remotePage ? SETTINGS_CATEGORIES.filter((c) => !DESKTOP_APP_ONLY.has(c.id)) : SETTINGS_CATEGORIES
}
