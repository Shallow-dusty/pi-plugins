import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import type { RuleList } from './panel.ts'

export async function saveRuleList<T>(
  list: RuleList,
  patterns: string[],
  validate: (value: unknown) => T,
): Promise<T> {
  const path = join(getAgentDir(), 'extensions', 'fast-mode.json')
  const original = await readFile(path, 'utf8').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error
      }
      return undefined
    },
  )
  const raw =
    original === undefined ? {} : (JSON.parse(original) as Record<string, unknown>)
  const current = validate(raw)
  if (
    Array.isArray(raw[list]) &&
    JSON.stringify(raw[list]) === JSON.stringify(patterns)
  ) {
    return current
  }

  const next = { ...raw, [list]: patterns }
  const decoded = validate(next)
  const suffix = randomUUID()
  const tmp = `${path}.${suffix}.tmp`
  const options = { flag: 'wx', mode: 0o600 }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, options)
  try {
    if (original !== undefined) {
      await writeFile(`${path}.${suffix}.bak`, original, options)
    }
    await rename(tmp, path)
  } finally {
    await rm(tmp, { force: true })
  }
  return decoded
}
