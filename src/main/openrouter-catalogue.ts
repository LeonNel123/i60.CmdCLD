/**
 * The OpenRouter model catalogue: ~400 models whose ids, prices and availability change
 * without us shipping a release.
 *
 * https://openrouter.ai/api/v1/models is public — no API key — so the catalogue works
 * before the user has configured anything, and a missing key never degrades it.
 *
 * Three layers, in order of preference:
 *   1. memory      — populated on first read, so the hot path never touches disk
 *   2. disk cache  — userData/openrouter-catalogue.json, survives restarts
 *   3. seed        — SEED_MODELS below, so a first run with no network still offers
 *                    the models the UI pins
 *
 * Reads are synchronous and never block on the network: getCatalogue() returns whatever
 * is known now and refreshes in the background when stale. Pricing feeds Autopilot's
 * cost cap, and a cost cap that waits on an HTTP round trip would stall a run.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const ENDPOINT = 'https://openrouter.ai/api/v1/models'
const CACHE_FILE = 'openrouter-catalogue.json'
/** Prices and model lists move on the order of days, not minutes. */
const TTL_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000

/** Per-million-token prices, matching the units used by the Autopilot cost tracker. */
export interface ModelRate {
  input: number
  cachedInput: number
  cacheCreation: number
  output: number
}

export interface CatalogueModel {
  id: string
  name: string
  contextLength: number
  /** supported_parameters includes 'tools' — required to drive an agent CLI's tool loop. */
  supportsTools: boolean
  rate: ModelRate
}

export interface Catalogue {
  fetchedAt: number
  models: CatalogueModel[]
}

/**
 * Minimal offline seed. Not a mirror of the catalogue — just enough that a first run
 * with no network can still select the models the UI pins. Anything here is replaced
 * wholesale by the first successful fetch.
 */
const SEED_MODELS: CatalogueModel[] = [
  { id: 'z-ai/glm-5.3-flash', name: 'GLM 5.3 Flash', contextLength: 1310720, supportsTools: true, rate: { input: 0.075, cachedInput: 0.015, cacheCreation: 0.075, output: 0.25 } },
  { id: 'z-ai/glm-5.3', name: 'GLM 5.3', contextLength: 1048576, supportsTools: true, rate: { input: 1.40, cachedInput: 0.26, cacheCreation: 1.40, output: 4.40 } },
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextLength: 1048576, supportsTools: true, rate: { input: 0.87, cachedInput: 0.87, cacheCreation: 0.87, output: 1.74 } },
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextLength: 1048576, supportsTools: true, rate: { input: 0.08, cachedInput: 0.08, cacheCreation: 0.08, output: 0.16 } },
  { id: 'qwen/qwen3.8-max', name: 'Qwen3.8 Max', contextLength: 1000000, supportsTools: true, rate: { input: 2.00, cachedInput: 2.00, cacheCreation: 2.00, output: 6.00 } },
  { id: 'qwen/qwen3.8-flash', name: 'Qwen3.8 Flash', contextLength: 1000000, supportsTools: true, rate: { input: 0.15, cachedInput: 0.15, cacheCreation: 0.15, output: 0.47 } },
  { id: 'qwen/qwen3.7-flash', name: 'Qwen3.7 Flash', contextLength: 1000000, supportsTools: true, rate: { input: 0.03, cachedInput: 0.03, cacheCreation: 0.03, output: 0.13 } },
  { id: 'moonshotai/kimi-k2.7-code', name: 'Kimi K2.7 Code', contextLength: 262144, supportsTools: true, rate: { input: 0.66, cachedInput: 0.66, cacheCreation: 0.66, output: 3.40 } },
  { id: 'moonshotai/kimi-k3', name: 'Kimi K3', contextLength: 1048576, supportsTools: true, rate: { input: 3.00, cachedInput: 0.30, cacheCreation: 3.00, output: 15.00 } },
  { id: 'minimax/minimax-m3', name: 'MiniMax M3', contextLength: 1048576, supportsTools: true, rate: { input: 0.30, cachedInput: 0.06, cacheCreation: 0.30, output: 1.20 } },
]

/** OpenRouter quotes per-token strings; the rest of the app works per million tokens. */
function perMillion(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(n) ? n * 1_000_000 : null
}

/**
 * Map one API entry, or null if it is unusable. A model with no prompt/completion price
 * is dropped rather than defaulted to zero: a zero rate would silently disable the
 * Autopilot cost cap for that model, which is worse than the model being absent.
 */
export function normalizeApiModel(raw: any): CatalogueModel | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null

  const input = perMillion(raw.pricing?.prompt)
  const output = perMillion(raw.pricing?.completion)
  if (input === null || output === null) return null

  // Only ~60% of models quote cache pricing; the rest bill cached reads at the full
  // input rate, so falling back to `input` matches how they actually charge.
  const cachedInput = perMillion(raw.pricing?.input_cache_read) ?? input
  const cacheCreation = perMillion(raw.pricing?.input_cache_write) ?? input

  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : raw.id,
    contextLength: Number(raw.context_length) || 0,
    supportsTools: Array.isArray(raw.supported_parameters) && raw.supported_parameters.includes('tools'),
    rate: { input, cachedInput, cacheCreation, output },
  }
}

let memory: Catalogue | null = null
let inFlight: Promise<Catalogue> | null = null
let cachePath: string | null = null
/**
 * Background refresh is opt-in via initCatalogue rather than automatic. Seed data is
 * always past its TTL, so an unguarded getCatalogue() would issue a live HTTP request
 * from anything that priced a model — including unit tests, which must not touch the
 * network to compute a cost.
 */
let autoRefresh = false

/** Called once at startup; without it the catalogue still serves, but never refreshes. */
export function initCatalogue(userDataDir: string): void {
  cachePath = join(userDataDir, CACHE_FILE)
  autoRefresh = true
}

function readDisk(): Catalogue | null {
  if (!cachePath || !existsSync(cachePath)) return null
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf-8'))
    if (!parsed || !Array.isArray(parsed.models) || parsed.models.length === 0) return null
    return { fetchedAt: Number(parsed.fetchedAt) || 0, models: parsed.models }
  } catch {
    // A truncated or hand-edited cache must not take the app down; the next fetch
    // rewrites it.
    return null
  }
}

function writeDisk(catalogue: Catalogue): void {
  if (!cachePath) return
  try {
    writeFileSync(cachePath, JSON.stringify(catalogue))
  } catch {
    // Disk full or read-only profile — the in-memory catalogue is still good.
  }
}

export async function refreshCatalogue(): Promise<Catalogue> {
  if (inFlight) return inFlight

  inFlight = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(ENDPOINT, { signal: controller.signal })
      if (!res.ok) throw new Error(`OpenRouter models: HTTP ${res.status}`)
      const body = await res.json()
      const models = (Array.isArray(body?.data) ? body.data : [])
        .map(normalizeApiModel)
        .filter((m: CatalogueModel | null): m is CatalogueModel => m !== null)
      if (models.length === 0) throw new Error('OpenRouter models: empty catalogue')

      const catalogue: Catalogue = { fetchedAt: Date.now(), models }
      memory = catalogue
      writeDisk(catalogue)
      return catalogue
    } finally {
      clearTimeout(timer)
      inFlight = null
    }
  })()

  return inFlight
}

/**
 * Best catalogue available right now, never blocking. Triggers a background refresh when
 * the data is missing or older than the TTL.
 */
export function getCatalogue(): Catalogue {
  if (!memory) memory = readDisk() ?? { fetchedAt: 0, models: SEED_MODELS }

  const stale = Date.now() - memory.fetchedAt > TTL_MS
  if (autoRefresh && stale && !inFlight) {
    // Detached on purpose: callers get today's answer immediately and a fresher one next
    // time. A rejection here is not actionable — the cached data is still serving.
    refreshCatalogue().catch(() => {})
  }

  return memory
}

/** Rate for a model id, or null when the catalogue has never heard of it. */
export function getCatalogueRate(modelId: string): ModelRate | null {
  return getCatalogue().models.find((m) => m.id === modelId)?.rate ?? null
}

/** Reset module state. Tests only. */
export function __resetCatalogueForTests(): void {
  memory = null
  inFlight = null
  cachePath = null
  autoRefresh = false
}
