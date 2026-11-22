import { folderPathPlaceholder } from '../../../shared/folder-input'

/** Browser stand-in for the native folder picker: a small in-page prompt
 *  where the user types or pastes a folder path on the host machine.
 *
 *  The path is resolved on the host before the prompt closes. What the
 *  native picker returns is always a real folder in its canonical spelling;
 *  typed text is neither — quoted ("Copy as path"), wrong-cased or with a
 *  trailing slash it used to become a dead tile or a duplicate project. A
 *  refusal is shown here, with the prompt still open to correct. */
export function promptForPath(opts: {
  /** The host's platform, not the browser's: it decides the path style. */
  platform: string
  /** Host-side resolution; rejects with the reason a path cannot be opened. */
  resolvePath: (raw: string) => Promise<string>
}): Promise<string | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font-family:monospace'
    wrap.innerHTML = `
      <div style="background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:16px;width:min(520px,90vw)">
        <div style="color:#e0e0e0;font-size:13px;margin-bottom:10px">Open project — folder path on the host</div>
        <input type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
          style="width:100%;box-sizing:border-box;background:#0d0d0d;color:#d4d4d4;border:1px solid #444;border-radius:4px;padding:8px;font:inherit">
        <div data-role="error" role="alert" style="color:#f87171;font-size:12px;min-height:16px;margin-top:8px;word-break:break-word"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button data-act="cancel" style="background:#2a2a3a;color:#ccc;border:1px solid #444;border-radius:4px;padding:6px 12px;font:inherit">Cancel</button>
          <button data-act="open" style="background:#6366f1;color:#fff;border:0;border-radius:4px;padding:6px 12px;font:inherit">Open</button>
        </div>
      </div>`
    const input = wrap.querySelector('input')!
    const error = wrap.querySelector<HTMLElement>('[data-role="error"]')!
    const openBtn = wrap.querySelector<HTMLButtonElement>('[data-act="open"]')!
    input.placeholder = folderPathPlaceholder(opts.platform)
    let closed = false
    const done = (value: string | null) => { closed = true; wrap.remove(); resolve(value) }
    let busy = false
    const submit = () => {
      if (busy) return
      const raw = input.value.trim()
      if (!raw) { done(null); return }
      busy = true
      openBtn.disabled = true
      error.textContent = ''
      opts.resolvePath(raw).then(
        (path) => { if (!closed) done(path) },
        (e) => {
          if (closed) return
          busy = false
          openBtn.disabled = false
          error.textContent = e instanceof Error ? e.message : String(e)
          input.focus()
        },
      )
    }
    wrap.querySelector('[data-act="cancel"]')!.addEventListener('click', () => done(null))
    openBtn.addEventListener('click', submit)
    input.addEventListener('input', () => { error.textContent = '' })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit()
      if (e.key === 'Escape') done(null)
    })
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(null) })
    document.body.appendChild(wrap)
    input.focus()
  })
}
