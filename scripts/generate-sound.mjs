// Generate a pleasant notification chime as a WAV file
// Two-tone ascending chime: C5 → E5, short and professional

import { writeFileSync, mkdirSync } from 'fs'

const SAMPLE_RATE = 44100
const DURATION = 0.4 // seconds total
const samples = Math.floor(SAMPLE_RATE * DURATION)
const buffer = new Float32Array(samples)

// Two-tone chime: first note C5 (523Hz), second note E5 (659Hz)
const note1Freq = 523.25 // C5
const note2Freq = 659.25 // E5
const note1End = Math.floor(samples * 0.45)
const note2Start = Math.floor(samples * 0.2)

for (let i = 0; i < samples; i++) {
  const t = i / SAMPLE_RATE
  let val = 0

  // Note 1: C5 with fade out
  if (i < note1End) {
    const env1 = 1 - (i / note1End) // fade out
    val += Math.sin(2 * Math.PI * note1Freq * t) * env1 * 0.3
    // Add soft harmonic
    val += Math.sin(2 * Math.PI * note1Freq * 2 * t) * env1 * 0.1
  }

  // Note 2: E5 with fade in then out
  if (i >= note2Start) {
    const pos = (i - note2Start) / (samples - note2Start)
    const env2 = pos < 0.1 ? pos / 0.1 : 1 - ((pos - 0.1) / 0.9) // fade in then out
    val += Math.sin(2 * Math.PI * note2Freq * t) * env2 * 0.3
    val += Math.sin(2 * Math.PI * note2Freq * 2 * t) * env2 * 0.08
  }

  buffer[i] = val
}

// Convert to 16-bit PCM WAV
const wavBuffer = new ArrayBuffer(44 + samples * 2)
const view = new DataView(wavBuffer)

// WAV header
const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)) }
writeStr(0, 'RIFF')
view.setUint32(4, 36 + samples * 2, true)
writeStr(8, 'WAVE')
writeStr(12, 'fmt ')
view.setUint32(16, 16, true) // chunk size
view.setUint16(20, 1, true) // PCM
view.setUint16(22, 1, true) // mono
view.setUint32(24, SAMPLE_RATE, true)
view.setUint32(28, SAMPLE_RATE * 2, true) // byte rate
view.setUint16(32, 2, true) // block align
view.setUint16(34, 16, true) // bits per sample
writeStr(36, 'data')
view.setUint32(40, samples * 2, true)

for (let i = 0; i < samples; i++) {
  const s = Math.max(-1, Math.min(1, buffer[i]))
  view.setInt16(44 + i * 2, s * 0x7FFF, true)
}

mkdirSync('build', { recursive: true })
writeFileSync('build/notification.wav', Buffer.from(wavBuffer))
console.log('Generated build/notification.wav')
