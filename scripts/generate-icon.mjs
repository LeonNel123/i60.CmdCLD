import sharp from 'sharp'
import png2icons from 'png2icons'
import { writeFileSync, mkdirSync } from 'fs'

// Generate a 512x512 PNG icon programmatically
// Design: Dark rounded square with terminal prompt symbol and grid dots

const SIZE = 512
const PAD = 64
const INNER = SIZE - PAD * 2
const R = 80 // corner radius

// Colors matching the app theme
const BG = '#0d1117'
const BORDER = '#22c55e'
const PROMPT = '#22c55e'
const DOTS = ['#f472b6', '#38bdf8', '#fb923c', '#a78bfa']

const svg = `
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <!-- Background rounded rect -->
  <rect x="${PAD}" y="${PAD}" width="${INNER}" height="${INNER}" rx="${R}" ry="${R}" fill="${BG}" stroke="${BORDER}" stroke-width="6"/>

  <!-- Terminal prompt: >_ -->
  <text x="${SIZE/2 - 60}" y="${SIZE/2 + 15}" font-family="Consolas, monospace" font-size="140" font-weight="700" fill="${PROMPT}">
    &gt;_
  </text>

  <!-- Grid dots in corners representing multi-terminal -->
  <circle cx="${PAD + 50}" cy="${PAD + 50}" r="14" fill="${DOTS[0]}"/>
  <circle cx="${SIZE - PAD - 50}" cy="${PAD + 50}" r="14" fill="${DOTS[1]}"/>
  <circle cx="${PAD + 50}" cy="${SIZE - PAD - 50}" r="14" fill="${DOTS[2]}"/>
  <circle cx="${SIZE - PAD - 50}" cy="${SIZE - PAD - 50}" r="14" fill="${DOTS[3]}"/>
</svg>
`

mkdirSync('build', { recursive: true })

// Generate PNG
const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer()
writeFileSync('build/icon.png', pngBuffer)

// Generate ICO from PNG
const icoBuffer = png2icons.createICO(pngBuffer, png2icons.BILINEAR, 0, true, true)
if (icoBuffer) {
  writeFileSync('build/icon.ico', icoBuffer)
  console.log('Generated build/icon.png and build/icon.ico')
} else {
  console.error('Failed to generate ICO')
}
