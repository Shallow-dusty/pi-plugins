import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from '@earendil-works/pi-tui'
import type { FastMode } from './policy.ts'

export type RuleList = 'whitelist' | 'blacklist'

type PanelState = {
  key: string
  mode: FastMode
  startupMode: FastMode
  state: 'on' | 'off' | 'unavailable'
  reason: string
  whitelist: readonly string[]
  blacklist: readonly string[]
}

type PanelActions = {
  state(): PanelState
  toggle(): void
  switchMode(): void
  editRules(list: RuleList, patterns: string[]): Promise<void>
}

export async function showFastPanel(
  ctx: ExtensionCommandContext,
  actions: PanelActions,
): Promise<void> {
  let message: { text: string; error: boolean } | undefined

  while (true) {
    const list = await ctx.ui.custom<RuleList | undefined>(
      (tui, theme, keys, done) => ({
        invalidate() {},
        render(width) {
          if (width < 5) {
            return []
          }
          const { key, mode, startupMode, state, reason, whitelist, blacklist } =
            actions.state()
          const inner = width - 4
          const border = (text: string) => theme.fg('borderAccent', text)
          const row = (text: string) => {
            const fitted = truncateToWidth(text, inner)
            return `${border('│')} ${fitted}${' '.repeat(Math.max(0, inner - visibleWidth(fitted)))} ${border('│')}`
          }
          const badge = theme.fg(
            state === 'on' ? 'success' : state === 'off' ? 'muted' : 'warning',
            state.toUpperCase(),
          )
          const ruleRow = (name: RuleList, patterns: readonly string[]) =>
            row(
              `${theme.fg('accent', `${name} (${patterns.length})`)}  ${patterns.join(', ') || '—'}`,
            )
          return [
            border(`╭${'─'.repeat(width - 2)}╮`),
            row(
              `${theme.bold(theme.fg('accent', 'pi-fast'))}  ${badge}  ${mode.toUpperCase()} · startup: ${startupMode}`,
            ),
            row(theme.fg('text', key)),
            row(theme.fg('muted', reason)),
            border(`├${'─'.repeat(width - 2)}┤`),
            ruleRow('whitelist', whitelist),
            ruleRow('blacklist', blacklist),
            row(
              message
                ? theme.fg(message.error ? 'error' : 'success', message.text)
                : theme.fg('dim', 'Auto: blacklist wins; unmatched stays off.'),
            ),
            row(theme.fg('muted', 'Space toggle · m mode · q/Esc close')),
            row(theme.fg('muted', 'w edit whitelist · b edit blacklist')),
            border(`╰${'─'.repeat(width - 2)}╯`),
          ]
        },
        handleInput(data) {
          if (data === 'q' || keys.matches(data, 'tui.select.cancel')) {
            done(undefined)
          } else if (data === 'w' || data === 'b') {
            done(data === 'w' ? 'whitelist' : 'blacklist')
          } else if (data === 'm' || matchesKey(data, Key.space)) {
            message = undefined
            if (data === 'm') {
              actions.switchMode()
            } else {
              actions.toggle()
            }
            tui.requestRender()
          }
        },
      }),
      {
        overlay: true,
        overlayOptions: { anchor: 'center', width: '82%', minWidth: 42, margin: 1 },
      },
    )

    if (list === undefined) {
      return
    }
    const text = await ctx.ui.editor(
      `pi-fast · ${list} (one provider/model glob per line)`,
      actions.state()[list].join('\n'),
    )
    if (text === undefined) {
      message = undefined
      continue
    }
    try {
      const patterns = [
        ...new Set(
          text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean),
        ),
      ]
      await actions.editRules(list, patterns)
      message = { text: `Saved ${list} (${patterns.length})`, error: false }
    } catch (error) {
      message = {
        text: `Could not save ${list}: ${error instanceof Error ? error.message : String(error)}`,
        error: true,
      }
    }
  }
}
