/** Browser stand-in for the native folder picker: a small in-page prompt
 *  where the user types or pastes a folder path on the host machine. */
export function promptForPath(): Promise<string | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font-family:monospace'
    wrap.innerHTML = `
      <div style="background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:16px;width:min(520px,90vw)">
        <div style="color:#e0e0e0;font-size:13px;margin-bottom:10px">Open project — folder path on the host</div>
        <input type="text" placeholder="/path/to/project" autocomplete="off"
          style="width:100%;box-sizing:border-box;background:#0d0d0d;color:#d4d4d4;border:1px solid #444;border-radius:4px;padding:8px;font:inherit">
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button data-act="cancel" style="background:#2a2a3a;color:#ccc;border:1px solid #444;border-radius:4px;padding:6px 12px;font:inherit">Cancel</button>
          <button data-act="open" style="background:#6366f1;color:#fff;border:0;border-radius:4px;padding:6px 12px;font:inherit">Open</button>
        </div>
      </div>`
    const input = wrap.querySelector('input')!
    const done = (value: string | null) => { wrap.remove(); resolve(value) }
    wrap.querySelector('[data-act="cancel"]')!.addEventListener('click', () => done(null))
    wrap.querySelector('[data-act="open"]')!.addEventListener('click', () => done(input.value.trim() || null))
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value.trim() || null)
      if (e.key === 'Escape') done(null)
    })
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(null) })
    document.body.appendChild(wrap)
    input.focus()
  })
}
