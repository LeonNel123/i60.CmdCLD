import { formatPtyWrite } from './pty-write'

const DEFAULT_CHUNK_SIZE = 1024
const DEFAULT_CHUNK_THRESHOLD = 1024
const DEFAULT_CHUNK_DELAY_MS = 5

export interface PtyInputChunkOptions {
  chunkSize?: number
  chunkThreshold?: number
}

export interface QueuedPtyWriterOptions extends PtyInputChunkOptions {
  chunkDelayMs?: number
  submitDelayMs?: number
}

export function chunkPtyInput(data: string, opts: PtyInputChunkOptions = {}): string[] {
  const formatted = formatPtyWrite(data)
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE
  const chunkThreshold = opts.chunkThreshold ?? DEFAULT_CHUNK_THRESHOLD
  const hasMultilineSubmit = data.endsWith('\r') && data.includes('\n') && formatted.endsWith('\x1b[201~\r')
  const body = hasMultilineSubmit ? formatted.slice(0, -1) : formatted

  if (body.length <= chunkThreshold) {
    return hasMultilineSubmit ? [body, '\r'] : [body]
  }

  const chunks: string[] = []
  for (let i = 0; i < body.length; i += chunkSize) {
    chunks.push(body.slice(i, i + chunkSize))
  }
  if (hasMultilineSubmit) chunks.push('\r')
  return chunks
}

export class QueuedPtyWriter {
  private queues = new Map<string, Promise<void>>()
  private chunkSize: number
  private chunkThreshold: number
  private chunkDelayMs: number
  private submitDelayMs: number

  constructor(
    private writeRaw: (terminalId: string, data: string) => void,
    opts: QueuedPtyWriterOptions = {},
  ) {
    this.chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE
    this.chunkThreshold = opts.chunkThreshold ?? DEFAULT_CHUNK_THRESHOLD
    this.chunkDelayMs = opts.chunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS
    this.submitDelayMs = opts.submitDelayMs ?? 300
  }

  write(terminalId: string, data: string): Promise<void> {
    const prior = this.queues.get(terminalId)
    const run = prior
      ? prior.catch(() => {}).then(() => this.writeChunks(terminalId, data))
      : this.writeChunks(terminalId, data)

    const tracked = run.catch(() => {}).finally(() => {
      if (this.queues.get(terminalId) === tracked) {
        this.queues.delete(terminalId)
      }
    })
    this.queues.set(terminalId, tracked)
    return run
  }

  private async writeChunks(terminalId: string, data: string): Promise<void> {
    const chunks = chunkPtyInput(data, {
      chunkSize: this.chunkSize,
      chunkThreshold: this.chunkThreshold,
    })
    for (let i = 0; i < chunks.length; i += 1) {
      this.writeRaw(terminalId, chunks[i])
      if (i < chunks.length - 1 && this.chunkDelayMs > 0) {
        const nextChunkIsSubmit = chunks[i + 1] === '\r'
        const delay = nextChunkIsSubmit ? this.submitDelayMs : this.chunkDelayMs
        await new Promise<void>((resolve) => setTimeout(resolve, delay))
      }
    }
  }
}
