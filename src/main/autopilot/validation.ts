import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { ValidationCommands } from './types'

export function discoverValidation(projectPath: string): ValidationCommands {
  const out: ValidationCommands = {}

  // ---- Node / package.json ----
  const pkgPath = join(projectPath, 'package.json')
  if (existsSync(pkgPath)) {
    let pkg: any = null
    try { pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) } catch { pkg = null }
    const scripts: Record<string, string> = pkg?.scripts ?? {}
    if (scripts['test:unit']) out.test = 'npm run test:unit'
    else if (scripts.test) out.test = 'npm test'
    if (scripts.build) out.build = 'npm run build'
    if (scripts.typecheck) out.typecheck = 'npm run typecheck'
    else if (scripts.tsc) out.typecheck = 'npm run tsc'
    if (scripts.lint) out.lint = 'npm run lint'
  }

  // tsc fallback when no typecheck script but tsconfig exists
  if (!out.typecheck && existsSync(join(projectPath, 'tsconfig.json'))) {
    out.typecheck = 'npx tsc --noEmit'
  }

  // ---- Rust ----
  if (!out.test && existsSync(join(projectPath, 'Cargo.toml'))) {
    out.test = 'cargo test'
    if (!out.build) out.build = 'cargo build'
  }

  // ---- Python ----
  if (!out.test) {
    const hasPy = existsSync(join(projectPath, 'pyproject.toml'))
      || existsSync(join(projectPath, 'pytest.ini'))
      || existsSync(join(projectPath, 'tests'))
    if (hasPy) out.test = 'pytest'
  }

  // ---- Go ----
  if (!out.test && existsSync(join(projectPath, 'go.mod'))) {
    out.test = 'go test ./...'
    if (!out.build) out.build = 'go build ./...'
  }

  return out
}
