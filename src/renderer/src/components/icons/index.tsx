import type { SVGProps } from 'react'
import { createElement } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function makeIcon(children: React.ReactNode) {
  return function Icon(props: IconProps) {
    return createElement(
      'svg',
      {
        width: 18,
        height: 18,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        ...props,
      },
      children,
    )
  }
}

// Folder open — for "Open Project" and context "Open"
export const FolderOpen = makeIcon(
  <>
    <path d="M6 14 4 18a2 2 0 0 0 1.8 2.8h12.4A2 2 0 0 0 20 18l-2-4z" />
    <path d="M2 13V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v5" />
  </>,
)

// Folder plus — for "New Project"
export const FolderPlus = makeIcon(
  <>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    <line x1="12" y1="11" x2="12" y2="17" />
    <line x1="9" y1="14" x2="15" y2="14" />
  </>,
)

// Sparkles — for "Quick Claude"
export const Sparkles = makeIcon(
  <>
    <path d="m12 3-1.5 4.5L6 9l4.5 1.5L12 15l1.5-4.5L18 9l-4.5-1.5z" />
    <path d="M5 18l-.75 2L2 21l2.25 1L5 24l.75-2L8 21l-2.25-1z" />
    <path d="M19 14l-.6 1.6L17 16l1.4.6L19 18l.6-1.6L21 16l-1.6-.6z" />
  </>,
)

// Terminal square — for "Quick Shell" and the rail
export const TerminalSquare = makeIcon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <polyline points="7 9 10 12 7 15" />
    <line x1="13" y1="15" x2="17" y2="15" />
  </>,
)

// App window — for "New Window" and "Open in new window"
export const AppWindow = makeIcon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18" />
    <path d="M9 3v6" />
  </>,
)

// Settings (gear)
export const Settings = makeIcon(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>,
)

// Layout grid — for "Show All"
export const LayoutGrid = makeIcon(
  <>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </>,
)

// X — for close, dismiss, "Close All"
export const X = makeIcon(
  <>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </>,
)

// Chevron left — collapse sidebar
export const ChevronLeft = makeIcon(<polyline points="15 18 9 12 15 6" />)

// Chevron right — expand sidebar / collapsed Recent
export const ChevronRight = makeIcon(<polyline points="9 18 15 12 9 6" />)

// Chevron down — expanded Recent
export const ChevronDown = makeIcon(<polyline points="6 9 12 15 18 9" />)

// Star — favorite. Pass `fill="currentColor"` to render filled.
export const Star = makeIcon(
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
)

// Folder search — "Open in Explorer"
export const FolderSearch = makeIcon(
  <>
    <path d="M11 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v3" />
    <circle cx="17" cy="17" r="3" />
    <path d="m21 21-1.5-1.5" />
  </>,
)

// Code — "Open in Editor"
export const Code = makeIcon(
  <>
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </>,
)

// Copy — "Copy path"
export const Copy = makeIcon(
  <>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>,
)

// Trash 2 — "Remove from recents"
export const Trash2 = makeIcon(
  <>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </>,
)

// Rotate ccw — Welcome-back card
export const RotateCcw = makeIcon(
  <>
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </>,
)

// Plus — generic, used in title bar of icon rail (kept for compatibility)
export const Plus = makeIcon(
  <>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </>,
)
