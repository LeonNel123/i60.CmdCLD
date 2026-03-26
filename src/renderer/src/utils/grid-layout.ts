export interface LayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
}

export function calculateLayout(count: number): LayoutItem[] {
  if (count === 0) return []

  const cols = count <= 2 ? count : count <= 4 ? 2 : 3
  const w = Math.floor(12 / cols)

  return Array.from({ length: count }, (_, idx) => ({
    i: String(idx),
    x: (idx % cols) * w,
    y: Math.floor(idx / cols),
    w,
    h: 1,
  }))
}
