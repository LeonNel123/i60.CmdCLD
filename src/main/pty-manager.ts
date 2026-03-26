import * as pty from 'node-pty'
import { WebContents } from 'electron'

export class PtyManager {
  private ptys = new Map<string, pty.IPty>()

  create(id: string, cwd: string, webContents: WebContents): void {
    const ptyProcess = pty.spawn('powershell.exe', [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>
    })

    ptyProcess.onData((data) => {
      if (!webContents.isDestroyed()) {
        webContents.send(`pty:data:${id}`, data)
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      if (!webContents.isDestroyed()) {
        webContents.send(`pty:exit:${id}`, exitCode)
      }
      this.ptys.delete(id)
    })

    this.ptys.set(id, ptyProcess)
  }

  write(id: string, data: string): void {
    this.ptys.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.ptys.get(id)?.resize(cols, rows)
  }

  kill(id: string): void {
    const p = this.ptys.get(id)
    if (p) {
      p.kill()
      this.ptys.delete(id)
    }
  }

  killAll(): void {
    for (const [id] of this.ptys) {
      this.kill(id)
    }
  }
}
