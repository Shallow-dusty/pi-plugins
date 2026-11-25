export type FastMode = 'auto' | 'manual'

/** Case-insensitive full-key matching, with the same * and ? syntax as Soul-Cast. */
export function compileModelPatterns(patterns: readonly string[]) {
  const compiled = patterns
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => {
      const source = pattern
        .replace(/[.+^$()|[\]{}\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
      return { pattern, re: new RegExp(`^${source}$`, 'i') }
    })
  return {
    match: (key: string) => compiled.find(({ re }) => re.test(key))?.pattern,
  }
}

type ModelPatterns = ReturnType<typeof compileModelPatterns>

export function resolvePolicy(
  mode: FastMode,
  manualEnabled: boolean,
  whitelist: ModelPatterns,
  blacklist: ModelPatterns,
  key: string | undefined,
): { enabled: boolean; reason: string } {
  if (mode === 'manual') {
    return { enabled: manualEnabled, reason: 'manual switch' }
  }
  if (!key) {
    return { enabled: false, reason: 'no model selected' }
  }
  const blocked = blacklist.match(key)
  if (blocked !== undefined) {
    return { enabled: false, reason: `blacklist: ${blocked}` }
  }
  const allowed = whitelist.match(key)
  if (allowed !== undefined) {
    return { enabled: true, reason: `whitelist: ${allowed}` }
  }
  return { enabled: false, reason: 'no whitelist match' }
}
