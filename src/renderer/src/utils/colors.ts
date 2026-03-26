export const COLOR_POOL = [
  '#f472b6', '#38bdf8', '#fb923c', '#a78bfa',
  '#22c55e', '#f87171', '#facc15', '#2dd4bf',
  '#818cf8', '#fb7185', '#34d399', '#fbbf24',
]

export function assignColor(usedColors: string[]): string {
  const available = COLOR_POOL.filter((c) => !usedColors.includes(c))
  const pool = available.length > 0 ? available : COLOR_POOL
  return pool[Math.floor(Math.random() * pool.length)]
}
