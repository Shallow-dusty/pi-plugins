import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { FastMode } from './policy.ts'

const SEGMENTS_KEY = Symbol.for('oh-my-line.segments.v1')

type Segment = {
  text: string
  compact: string
  minimal: string
  category: 'custom'
  slot: 'model-left'
  priority: number
  suppressRawStatus: true
}

type LineRegistry = {
  version: 1
  set(id: string, segment: Segment): void
  delete(id: string): void
}

function getLineRegistry(): LineRegistry | undefined {
  const registry = (globalThis as Record<symbol, unknown>)[SEGMENTS_KEY] as
    | LineRegistry
    | undefined
  return registry?.version === 1 ? registry : undefined
}

export function publishStatus(
  ctx: ExtensionContext,
  id: string,
  mode: FastMode,
): void {
  const text = `Fast · ${mode}`
  getLineRegistry()?.set(id, {
    text,
    compact: 'Fast',
    minimal: 'Fast',
    category: 'custom',
    slot: 'model-left',
    priority: 4,
    suppressRawStatus: true,
  })
  // The registry suppresses this fallback when oh-my-line renders the segment.
  ctx.ui.setStatus(id, text)
}

export function clearStatus(ctx: ExtensionContext, id: string): void {
  getLineRegistry()?.delete(id)
  ctx.ui.setStatus(id, undefined)
}
