import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'

function copyRemoteUi() {
  return {
    name: 'copy-remote-ui',
    closeBundle() {
      const src = join(__dirname, 'src/remote-ui')
      const dest = join(__dirname, 'out/remote-ui')
      mkdirSync(dest, { recursive: true })
      for (const file of readdirSync(src)) {
        copyFileSync(join(src, file), join(dest, file))
      }
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyRemoteUi()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
