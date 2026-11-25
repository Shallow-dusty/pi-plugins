import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { visibleWidth } from '@earendil-works/pi-tui'
import fastMode from '../dist/index.mjs'

const segmentsKey = Symbol.for('oh-my-line.segments.v1')
const envKey = 'PI_CODING_AGENT_DIR'
const cpa = { provider: 'cpa', id: 'gpt-6.2-sol', api: 'openai-responses' }
const sol = {
  provider: 'openai-codex',
  id: 'gpt-6-sol',
  api: 'openai-codex-responses',
}
const luna = { ...sol, id: 'gpt-6-luna' }
const config = {
  models: ['cpa/gpt-6.2-sol', 'openai-codex/gpt-6-*'],
  whitelist: ['cpa/gpt-6.2-sol', 'OPENAI-CODEX/gpt-?-*', 'other/*'],
  blacklist: ['*/gpt-6-luna'],
}

async function start(t, settings, { flag = false, line = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pi-fast-mode-'))
  const previousAgentDir = process.env[envKey]
  const previousRegistry = globalThis[segmentsKey]
  t.after(async () => {
    if (previousAgentDir === undefined) {
      delete process.env[envKey]
    } else {
      process.env[envKey] = previousAgentDir
    }
    if (previousRegistry === undefined) {
      delete globalThis[segmentsKey]
    } else {
      globalThis[segmentsKey] = previousRegistry
    }
    await rm(dir, { recursive: true })
  })
  await mkdir(join(dir, 'extensions'))
  await writeFile(
    join(dir, 'extensions', 'fast-mode.json'),
    JSON.stringify(settings),
  )
  process.env[envKey] = dir

  const segments = new Map()
  if (line) {
    globalThis[segmentsKey] = {
      version: 1,
      set: segments.set.bind(segments),
      delete: segments.delete.bind(segments),
    }
  } else {
    delete globalThis[segmentsKey]
  }
  const statuses = new Map()
  const notes = []
  const ctx = {
    hasUI: true,
    model: cpa,
    ui: {
      setStatus(id, text) {
        if (text === undefined) {
          statuses.delete(id)
        } else {
          statuses.set(id, text)
        }
      },
      notify: (text) => notes.push(text),
    },
  }
  const events = new Map()
  const commands = new Map()
  fastMode({
    on: (name, hook) => events.set(name, hook),
    registerFlag: () => {},
    getFlag: (name) => name === 'fast' && flag,
    registerCommand: (name, command) => commands.set(name, command),
  })
  await events.get('session_start')({}, ctx)

  return {
    ctx,
    dir,
    segments,
    statuses,
    notes,
    select(model) {
      ctx.model = model
      events.get('model_select')({ model }, ctx)
    },
    request: (payload = { model: ctx.model?.id }) =>
      events.get('before_provider_request')({ payload }, ctx),
    command: (args) => commands.get('fast').handler(args, ctx),
    stop: () => events.get('session_shutdown')({}, ctx),
  }
}

test('auto follows the model, with blacklist taking precedence and Fast clearing the footer', async (t) => {
  const fast = await start(t, config)
  assert.equal(fast.request()?.service_tier, 'priority')
  assert.equal(fast.segments.get('fast-mode')?.text, 'Fast · auto')
  assert.equal(fast.segments.get('fast-mode')?.suppressRawStatus, true)
  fast.select(sol)
  assert.equal(fast.request()?.service_tier, 'priority')
  fast.select(luna)
  assert.equal(fast.request(), undefined)
  assert.equal(fast.segments.has('fast-mode'), false)
  assert.equal(fast.statuses.has('fast-mode'), false)
  await fast.command('status')
  assert.match(fast.notes.at(-1), /auto.*off.*blacklist: \*\/gpt-6-luna/)
  fast.select({ ...cpa, id: 'gpt-6x2-sol' })
  assert.equal(fast.request(), undefined, 'dots in patterns are literal')
  fast.select(undefined)
  assert.equal(fast.request(), undefined)
})

test('manual overrides auto rules for the session and can return to auto', async (t) => {
  const fast = await start(t, { ...config, mode: 'auto' })
  await fast.command('toggle')
  assert.equal(fast.request(), undefined)
  fast.select(luna)
  await fast.command('on')
  assert.equal(fast.request()?.service_tier, 'priority')
  assert.equal(fast.segments.get('fast-mode')?.text, 'Fast · manual')
  await fast.command('auto')
  assert.equal(fast.request(), undefined)
  await fast.command('manual')
  assert.equal(fast.request()?.service_tier, 'priority')
  await fast.command('off')
  assert.equal(fast.request(), undefined)
  await fast.command('auto')
  fast.select(cpa)
  assert.equal(fast.request()?.service_tier, 'priority')
  fast.stop()
  assert.equal(fast.segments.has('fast-mode'), false)
  assert.equal(fast.statuses.has('fast-mode'), false)
})

test('eligibility and existing service-tier protections apply in both modes', async (t) => {
  const fast = await start(t, config)
  fast.select({ ...cpa, provider: 'other' })
  assert.equal(fast.request(), undefined, 'whitelist cannot grant eligibility')
  await fast.command('on')
  assert.equal(fast.request(), undefined, 'manual on cannot grant eligibility')
  fast.select({ ...cpa, api: 'openai-completions' })
  assert.equal(fast.request(), undefined)
  fast.select(cpa)
  assert.equal(fast.request({ model: cpa.id, service_tier: 'default' }), undefined)
  assert.equal(fast.request({ model: 'wrong' }), undefined)
  assert.equal(fast.request(null), undefined)
})

test('legacy enabled configs still work without oh-my-line', async (t) => {
  const fast = await start(
    t,
    { models: config.models, enabled: true },
    { line: false },
  )
  assert.equal(fast.request()?.service_tier, 'priority')
  assert.equal(fast.statuses.get('fast-mode'), 'Fast · manual')
  await fast.command('auto')
  assert.equal(fast.request(), undefined, 'unmatched models are off in auto mode')
})

test('--fast selects manual on, and showStatus hides both indicators', async (t) => {
  const fast = await start(t, { ...config, showStatus: false }, { flag: true })
  fast.select(luna)
  assert.equal(fast.request()?.service_tier, 'priority')
  assert.equal(fast.statuses.size, 0)
  assert.equal(fast.segments.size, 0)
})

test('/fast opens the panel, toggles modes, and backs up saved rules', async (t) => {
  const original = { ...config, mode: 'auto', unknownSetting: 'preserved' }
  const fast = await start(t, original)
  const keys = [[' ', 'm', 'w'], ['b'], ['q']]
  const renderFrames = []
  const themed = { fg: (_role, text) => text, bold: (text) => text }
  const editors = []
  fast.ctx.mode = 'tui'
  fast.ctx.ui.custom = async (factory, options) => {
    assert.equal(options.overlay, true)
    let result
    let closed = false
    const component = factory(
      { requestRender: () => {} },
      themed,
      { matches: () => false },
      (value) => {
        closed = true
        result = value
      },
    )
    for (const key of keys.shift()) {
      const rows = component.render(62)
      assert.equal(
        rows.every((row) => visibleWidth(row) === 62),
        true,
      )
      renderFrames.push(rows.join('\n'))
      component.handleInput(key)
    }
    assert.equal(closed, true)
    return result
  }
  fast.ctx.ui.editor = async (title, prefilled) => {
    editors.push({ title, prefilled })
    return editors.length === 1
      ? ' openai-codex/gpt-6-* \nopenai-codex/gpt-6-*\n'
      : undefined
  }

  await fast.command('')
  assert.match(renderFrames[0], /pi-fast\s+ON\s+AUTO/)
  assert.match(renderFrames[1], /pi-fast\s+OFF\s+MANUAL/)
  assert.match(renderFrames[2], /pi-fast\s+ON\s+AUTO/)
  assert.match(renderFrames[3], /Saved whitelist \(1\)/)
  assert.deepEqual(
    editors.map(({ prefilled }) => prefilled),
    [config.whitelist.join('\n'), config.blacklist.join('\n')],
  )
  assert.equal(fast.request(), undefined)
  const extensions = join(fast.dir, 'extensions')
  const files = await readdir(extensions)
  const backup = files.filter((path) => path.endsWith('.bak'))
  assert.equal(backup.length, 1)
  assert.deepEqual(
    JSON.parse(await readFile(join(extensions, backup[0]), 'utf8')),
    original,
  )
  assert.deepEqual(
    JSON.parse(await readFile(join(extensions, 'fast-mode.json'), 'utf8')),
    {
      ...original,
      whitelist: ['openai-codex/gpt-6-*'],
    },
  )
})
