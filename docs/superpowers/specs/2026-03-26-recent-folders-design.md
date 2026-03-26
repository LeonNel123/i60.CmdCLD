# Recent Folders — Design Spec

## Overview

Add a local SQLite database that remembers the last 20 folders opened. An expandable "Recent" section in the sidebar lets users quickly reopen previous folders. Folders already open show as disabled. List order is frozen for the session — only re-sorts on app restart.

## SQLite Database

File: `{userData}/recent.db`

```sql
CREATE TABLE IF NOT EXISTS recent_folders (
  path TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  last_opened INTEGER NOT NULL
);
```

- `path` is the full folder path (primary key, no duplicates)
- `name` is the folder basename (for display)
- `last_opened` is a Unix timestamp in milliseconds

On add: `INSERT OR REPLACE INTO recent_folders (path, name, last_opened) VALUES (?, ?, ?)` — upserts, updating timestamp if already exists.

After insert, prune to keep only the 20 most recent: `DELETE FROM recent_folders WHERE path NOT IN (SELECT path FROM recent_folders ORDER BY last_opened DESC LIMIT 20)`.

## Main Process — RecentDB class

New file: `src/main/recent-db.ts`

```ts
class RecentDB {
  constructor(dbPath: string)  // Opens/creates SQLite DB, runs CREATE TABLE IF NOT EXISTS
  add(path: string): void      // Upsert + prune to 20
  list(): Array<{ path: string; name: string; lastOpened: number }>  // Top 20 ordered by last_opened DESC
}
```

Uses `better-sqlite3` (synchronous, no native rebuild issues with prebuilds).

## IPC

| Channel | Args | Returns | Description |
|---------|------|---------|-------------|
| `recent:list` | none | `Array<{path, name, lastOpened}>` | Get recent folders, ordered by last_opened DESC |
| `recent:add` | `path: string` | void | Upsert folder into recent list |

`recent:add` is called from the renderer whenever a new terminal is created (in `handleAddFolder`).

## Preload Additions

```ts
recentList: () => ipcRenderer.invoke('recent:list'),
recentAdd: (path: string) => ipcRenderer.invoke('recent:add', path),
```

## Type Additions

```ts
interface RecentFolder {
  path: string
  name: string
  lastOpened: number
}

// Add to ElectronAPI:
recentList: () => Promise<RecentFolder[]>
recentAdd: (path: string) => Promise<void>
```

## Sidebar Changes

### Expanded sidebar

Add a "Recent" section between the active terminals list and the bottom actions:

- Header row: "Recent" label + expand/collapse chevron
- Below: list of recent folders (when expanded)
- Each item shows the folder basename
- Folders that match an active terminal's path → disabled style (greyed out, no click)
- Enabled folders → click to fire `onOpenRecent(path)` callback
- Expand/collapse state persisted to `localStorage` key `sidebar-recent-expanded`

### Collapsed sidebar

Recent section is hidden entirely — only active terminal dots and action buttons shown.

### Props addition

```ts
interface SidebarProps {
  // ... existing props ...
  recentFolders: RecentFolder[]
  onOpenRecent: (path: string) => void
}
```

## App.tsx Changes

- Load recent folders on mount: call `window.api.recentList()`, store in state
- The list is loaded ONCE on mount and frozen for the session (no re-fetching after opening folders)
- When `handleAddFolder` creates a terminal, also call `window.api.recentAdd(path)` to update the DB silently (but don't re-fetch the list into state)
- Add `handleOpenRecent(path)` — creates a new terminal for the given path (same as `handleAddFolder` but without the file picker). Also calls `recentAdd(path)`.
- Pass `recentFolders` and `onOpenRecent` to Sidebar

## Edge Cases

- Folder path no longer exists on disk: still shows in recent list (clicking it will create a terminal that shows the PowerShell error — no pre-validation needed)
- Duplicate paths: impossible — SQLite PRIMARY KEY constraint
- More than 20 entries: pruned on every add
- Empty recent list: "Recent" section header still shows, just empty when expanded
