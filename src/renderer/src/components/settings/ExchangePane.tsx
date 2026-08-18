import { EditableList, Field, INPUT_STYLE, MONO_FONT, PaneHeading } from './controls'

// Exchange-protocol settings: the domain hubs this machine holds clones of,
// and how often the relay polls them for cross-machine nudges. The relay
// itself needs no configuration — sessions on this machine are always
// addressable; hubs make session@MACHINE targets reachable too.

export interface ExchangePaneProps {
  hubClones: string[]
  onHubClonesChange: (v: string[]) => void
  pollSec: number
  onPollSecChange: (v: number) => void
}

export function ExchangePane(p: ExchangePaneProps) {
  const handleAddClone = async () => {
    const folder = await window.api.selectFolder()
    if (folder && !p.hubClones.includes(folder)) {
      p.onHubClonesChange([...p.hubClones, folder])
    }
  }

  return (
    <div>
      <PaneHeading>Exchange</PaneHeading>

      <Field
        label="Domain hub clones"
        hint="Local checkouts of your exchange hubs (a hub root has outbound/, inbound/ and REPOS.md). Polled for cross-machine relay nudges; outgoing nudges to session@MACHINE targets are committed to the hub that holds the cited document."
      >
        <EditableList
          items={p.hubClones}
          onChange={p.onHubClonesChange}
          addLabel="+ Add hub clone"
          onRequestAdd={() => { void handleAddClone() }}
        />
      </Field>

      <Field label="Hub poll interval (seconds)" hint="How often hub clones are pulled and checked for nudges. Minimum 30.">
        <input
          type="number"
          min={30}
          value={p.pollSec}
          onChange={(e) => p.onPollSecChange(Math.max(30, parseInt(e.target.value) || 120))}
          style={{ ...INPUT_STYLE, width: '100px', padding: '6px 10px', fontFamily: MONO_FONT }}
        />
      </Field>

      <div style={{ color: '#555', fontSize: '10px', fontFamily: 'inherit', lineHeight: 1.5 }}>
        Incoming nudges land in the session&apos;s envelope inbox (the flashing mail
        icon) — nothing is ever typed into a composer without a click. Delivery
        markers are committed back to the hub, so other machines see what arrived.
      </div>
    </div>
  )
}
