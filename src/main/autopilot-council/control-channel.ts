import {
  asString, asStringArray, makeControlChannel,
  type BaseControlMarker, type ControlMarkerValidationError,
} from '../autopilot-shared/control-channel'
import { ALL_DECISION_SHAPES, type DecisionShape, type ProMarker } from '../autopilot-pro/types'
import { COUNCIL_DIR, type CouncilSettledSnapshot } from './types'

function validateOptionsRationale(value: unknown):
  ProMarker['optionsRationale'] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: NonNullable<ProMarker['optionsRationale']> = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const option = asString(o.option)
    if (!option) continue
    out.push({
      option,
      pros: asStringArray(o.pros) ?? [],
      cons: asStringArray(o.cons) ?? [],
    })
  }
  return out.length ? out : undefined
}

function validateResearchTopics(value: unknown):
  ProMarker['researchTopics'] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: NonNullable<ProMarker['researchTopics']> = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const slug = asString(o.slug); const query = asString(o.query)
    if (!slug || !query) continue
    const topic: NonNullable<ProMarker['researchTopics']>[number] = { slug, query }
    const sources = asStringArray(o.sources); if (sources) topic.sources = sources
    if (typeof o.force === 'boolean') topic.force = o.force
    out.push(topic)
  }
  return out.length ? out : undefined
}

const councilChannel = makeControlChannel<ProMarker>({
  dir: COUNCIL_DIR,
  validateExtra: (obj, base): { marker: ProMarker } | ControlMarkerValidationError => {
    const m: ProMarker = { ...(base as BaseControlMarker) } as ProMarker
    if (obj.shape !== undefined) {
      if (typeof obj.shape !== 'string' ||
          !(ALL_DECISION_SHAPES as readonly string[]).includes(obj.shape)) {
        return { reason: `shape must be one of: ${ALL_DECISION_SHAPES.join(', ')}` }
      }
      m.shape = obj.shape as DecisionShape
    }
    const proStatus = asString(obj.proStatus); if (proStatus) m.proStatus = proStatus
    const artifactPath = asString(obj.artifactPath); if (artifactPath) m.artifactPath = artifactPath
    const options = asStringArray(obj.options); if (options) m.options = options
    const assumption = asString(obj.assumption); if (assumption) m.assumption = assumption
    const delta = asString(obj.delta); if (delta) m.delta = delta
    if (typeof obj.subagentEtaMin === 'number' && Number.isFinite(obj.subagentEtaMin)) {
      m.subagentEtaMin = obj.subagentEtaMin
    }
    const optionsRationale = validateOptionsRationale(obj.optionsRationale)
    if (optionsRationale) m.optionsRationale = optionsRationale
    const researchTopics = validateResearchTopics(obj.researchTopics)
    if (researchTopics) m.researchTopics = researchTopics
    const researchTopic = asString(obj.researchTopic); if (researchTopic) m.researchTopic = researchTopic
    if (typeof obj.researchForce === 'boolean') m.researchForce = obj.researchForce
    return { marker: m }
  },
})

export const readCouncilControlMarker = councilChannel.readControlMarker
export const writeCouncilInboxReply = councilChannel.writeInboxReply

export function markerToCouncilSnapshot(
  marker: ProMarker,
  receivedAt = Date.now(),
): CouncilSettledSnapshot {
  return { text: 'file-control-channel', marker, receivedAt }
}
