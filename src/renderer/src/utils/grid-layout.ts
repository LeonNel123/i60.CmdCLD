export interface LayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
}

export function calculateLayout(count: number): LayoutItem[] {
  if (count === 0) return []

  // Determine grid dimensions
  // 1: 1x1, 2: 2x1, 3: 3x1, 4: 2x2, 5-6: 3x2, 7-9: 3x3
  let cols: number
  let rows: number

  if (count === 1) {
    cols = 1; rows = 1
  } else if (count === 2) {
    cols = 2; rows = 1
  } else if (count === 3) {
    cols = 3; rows = 1
  } else if (count === 4) {
    cols = 2; rows = 2
  } else if (count <= 6) {
    cols = 3; rows = 2
  } else {
    cols = 3; rows = Math.ceil(count / 3)
  }

  const w = Math.floor(12 / cols)

  return Array.from({ length: count }, (_, idx) => ({
    i: String(idx),
    x: (idx % cols) * w,
    y: Math.floor(idx / cols),
    w,
    h: 1, // will be scaled by rowHeight in App.tsx
  }))
}

/** How many visual rows the layout uses */
export function getRowCount(count: number): number {
  if (count === 0) return 1
  if (count <= 3) return 1
  if (count <= 6) return 2
  return Math.ceil(count / 3)
}
