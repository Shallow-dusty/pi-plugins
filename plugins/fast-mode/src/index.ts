import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import * as ExtensionConfig from '@pi-plugins/shared/config'
import { Data, Effect, Option, Predicate, Record, Schema } from 'effect'
import { showFastPanel } from './panel.ts'
import { compileModelPatterns, resolvePolicy, type FastMode } from './policy.ts'
import { saveRuleList } from './rules-config.ts'
import { clearStatus, publishStatus } from './status.ts'

const EXTENSION_ID = 'fast-mode'

const FastModeConfig = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  mode: Schema.optionalKey(Schema.Literals(['auto', 'manual'])),
  whitelist: Schema.optionalKey(Schema.Array(Schema.String)),
  blacklist: Schema.optionalKey(Schema.Array(Schema.String)),
  models: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefault(
      Effect.succeed([
        'openai/gpt-5.4',
        'openai/gpt-5.5',
        'openai/gpt-5.6-sol',
        'openai/gpt-5.6-terra',
        'openai/gpt-5.6-luna',
        'openai/gpt-6-astra',
        'openai/gpt-6-sol',
        'openai/gpt-6-luna',
        'openai/gpt-6.1-sol',
        'openai-codex/gpt-5.4',
        'openai-codex/gpt-5.5',
        'openai-codex/gpt-5.6-sol',
        'openai-codex/gpt-5.6-terra',
        'openai-codex/gpt-5.6-luna',
        'openai-codex/gpt-6-astra',
        'openai-codex/gpt-6-sol',
        'openai-codex/gpt-6-luna',
        'openai-codex/gpt-6.1-sol',
      ]),
    ),
  ),
  showStatus: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
})

const decodeConfig = Schema.decodeUnknownSync(FastModeConfig)

function startupMode(config: typeof FastModeConfig.Type): FastMode {
  return config.mode ?? (config.whitelist || config.blacklist ? 'auto' : 'manual')
}

function modelKey(model: ExtensionContext['model']): string | undefined {
  return model && `${model.provider}/${model.id}`
}

type Applicator = (
  payload: Record<string, unknown>,
  model: NonNullable<ExtensionContext['model']>,
) => Record<string, unknown> | undefined

type Eligibility = Data.TaggedEnum<{
  Eligible: { readonly apply: Applicator }
  Ineligible: { readonly message: string }
}>
const Eligibility = Data.taggedEnum<Eligibility>()

const FAST_APPLICATORS: Record<string, Applicator> = {
  'openai-responses': applyOpenAIPriorityTier,
  'openai-codex-responses': applyOpenAIPriorityTier,
} satisfies Record<'openai-responses' | 'openai-codex-responses', Applicator>

function applyOpenAIPriorityTier(
  payload: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return Record.has(payload, 'service_tier')
    ? undefined
    : { ...payload, service_tier: 'priority' }
}

export default function fastMode(pi: ExtensionAPI) {
  const defaults = decodeConfig({})
  let config = defaults
  let mode: FastMode = 'manual'
  let manualEnabled = false
  let whitelist = compileModelPatterns([])
  let blacklist = compileModelPatterns([])
  let models = compileModelPatterns(config.models)

  function applyConfig(next: typeof FastModeConfig.Type): void {
    config = next
    whitelist = compileModelPatterns(config.whitelist ?? [])
    blacklist = compileModelPatterns(config.blacklist ?? [])
    models = compileModelPatterns(config.models)
  }

  function decisionFor(model: ExtensionContext['model']) {
    return resolvePolicy(mode, manualEnabled, whitelist, blacklist, modelKey(model))
  }

  function setManual(ctx: ExtensionContext, enabled: boolean) {
    manualEnabled = enabled
    mode = 'manual'
    updateStatus(ctx)
  }

  function setMode(ctx: ExtensionContext, next: FastMode) {
    mode = next
    updateStatus(ctx)
  }

  function checkEligibility(model: ExtensionContext['model']): Eligibility {
    if (!model) {
      return Eligibility.Ineligible({ message: 'no model is selected' })
    }

    const key = `${model.provider}/${model.id}`
    if (models.match(key) === undefined) {
      return Eligibility.Ineligible({
        message: `${key} is not in the configured models`,
      })
    }

    return Option.match(Record.get(FAST_APPLICATORS, model.api), {
      onNone: () =>
        Eligibility.Ineligible({
          message: `the ${model.api} API has no fast-mode support`,
        }),
      onSome: (apply) => Eligibility.Eligible({ apply }),
    })
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) {
      return
    }

    const active =
      config.showStatus &&
      decisionFor(ctx.model).enabled &&
      Eligibility.$is('Eligible')(checkEligibility(ctx.model))
    if (active) {
      publishStatus(ctx, EXTENSION_ID, mode)
    } else {
      clearStatus(ctx, EXTENSION_ID)
    }
  }

  function notifyState(ctx: ExtensionContext): void {
    const { key, state, reason, unavailable } = snapshot(ctx)
    const status = unavailable ? `unavailable: ${unavailable}` : state
    ctx.ui.notify(`Fast (${mode}): ${status} · ${key} · ${reason}`, 'info')
  }

  function snapshot(ctx: ExtensionContext) {
    const { enabled, reason } = decisionFor(ctx.model)
    const eligibility = checkEligibility(ctx.model)
    const unavailable = Eligibility.$is('Ineligible')(eligibility)
      ? eligibility.message
      : undefined
    const state = unavailable ? 'unavailable' : enabled ? 'on' : 'off'
    return {
      key: modelKey(ctx.model) ?? 'no model',
      mode,
      startupMode: startupMode(config),
      state,
      unavailable,
      reason,
      whitelist: config.whitelist ?? [],
      blacklist: config.blacklist ?? [],
    } as const
  }

  pi.on('session_start', async (_event, ctx) => {
    applyConfig(
      await ExtensionConfig.load(ctx, FastModeConfig, EXTENSION_ID, defaults),
    )
    const flag = pi.getFlag('fast') === true
    manualEnabled = flag || config.enabled
    setMode(ctx, flag ? 'manual' : startupMode(config))
  })

  pi.on('model_select', (_event, ctx) => {
    updateStatus(ctx)
  })

  pi.on('session_shutdown', (_event, ctx) => {
    if (ctx.hasUI) {
      clearStatus(ctx, EXTENSION_ID)
    }
  })

  pi.on('before_provider_request', (event, ctx) => {
    const model = ctx.model
    if (!model || !decisionFor(model).enabled) {
      return undefined
    }

    const eligibility = checkEligibility(model)
    if (
      Eligibility.$is('Ineligible')(eligibility) ||
      !Predicate.isObject(event.payload) ||
      event.payload['model'] !== model.id
    ) {
      return undefined
    }

    return eligibility.apply(event.payload, model)
  })

  pi.registerFlag('fast', {
    description: 'Start in manual mode with Fast enabled',
    type: 'boolean',
    default: false,
  })

  pi.registerCommand('fast', {
    description: 'Open the pi-fast panel or control priority inference',
    getArgumentCompletions: (prefix) => {
      const items = ['auto', 'manual', 'on', 'off', 'toggle', 'status']
        .filter((arg) => arg.startsWith(prefix))
        .map((arg) => ({ value: arg, label: arg }))
      return items.length > 0 ? items : null
    },
    handler: async (args, ctx) => {
      const cmd = args.trim().toLowerCase()
      const toggle = () => setManual(ctx, !decisionFor(ctx.model).enabled)
      switch (cmd) {
        case '':
          if (ctx.hasUI && ctx.mode === 'tui') {
            await showFastPanel(ctx, {
              state: () => {
                const current = snapshot(ctx)
                return { ...current, reason: current.unavailable ?? current.reason }
              },
              toggle,
              switchMode: () => setMode(ctx, mode === 'auto' ? 'manual' : 'auto'),
              editRules: async (list, patterns) => {
                applyConfig(await saveRuleList(list, patterns, decodeConfig))
                updateStatus(ctx)
              },
            })
            return
          }
          break
        case 'toggle':
          toggle()
          break
        case 'on':
        case 'off':
          setManual(ctx, cmd === 'on')
          break
        case 'auto':
        case 'manual':
          setMode(ctx, cmd)
          break
        case 'status':
          break
        default:
          ctx.ui.notify('Usage: /fast [auto|manual|on|off|toggle|status]', 'warning')
          return
      }
      notifyState(ctx)
    },
  })
}
