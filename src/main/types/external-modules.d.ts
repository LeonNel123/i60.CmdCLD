declare module 'express' {
  type Handler = (...args: any[]) => void

  interface ExpressApp {
    (...args: any[]): void
    use: (...args: any[]) => void
    get: (path: string, handler: Handler) => void
    post: (path: string, handler: Handler) => void
    put: (path: string, handler: Handler) => void
    delete: (path: string, handler: Handler) => void
  }

  interface ExpressFactory {
    (): ExpressApp
    static: (path: string) => any
    json: (opts?: unknown) => any
  }

  const express: ExpressFactory
  export default express
}

declare module 'sql.js/dist/sql-asm.js' {
  export class Database {
    constructor(data?: Uint8Array)
    run(sql: string, params?: unknown[]): void
    exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>
    export(): Uint8Array
    close(): void
  }

  export default function initSqlJs(config?: unknown): Promise<{ Database: typeof Database }>
}
