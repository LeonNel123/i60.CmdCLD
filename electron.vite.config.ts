import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
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

      // Bundle xterm vendor files so remote UI works in production
      const xtermPkg = join(__dirname, 'node_modules/@xterm/xterm')
      const fitPkg = join(__dirname, 'node_modules/@xterm/addon-fit')

      const xtermCssDest = join(dest, 'vendor/xterm/css')
      const xtermLibDest = join(dest, 'vendor/xterm/lib')
      const fitLibDest = join(dest, 'vendor/xterm-addon-fit/lib')

      mkdirSync(xtermCssDest, { recursive: true })
      mkdirSync(xtermLibDest, { recursive: true })
      mkdirSync(fitLibDest, { recursive: true })

      copyFileSync(join(xtermPkg, 'css/xterm.css'), join(xtermCssDest, 'xterm.css'))
      copyFileSync(join(xtermPkg, 'lib/xterm.js'), join(xtermLibDest, 'xterm.js'))
      copyFileSync(join(fitPkg, 'lib/addon-fit.js'), join(fitLibDest, 'xterm-addon-fit.js'))
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
