# `pi-fast`

Request priority inference for selected models in
[pi](https://github.com/earendil-works/pi), automatically by model or with a manual
session toggle. This fork integrates with the oh-my-line footer.

## Install

From the fork's monorepo root, build and install the local package. If the upstream
npm package is configured, remove that declaration first to avoid two `/fast`
commands.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm --filter pi-fast build
pi remove npm:@pi-plugins/fast-mode@0.1.16 # only if installed at this pin
pi install "$PWD/plugins/fast-mode"
```

Run `/reload` in an existing Pi session.

## Usage

Use `/fast` to open the Pi overlay. It shows the current model, Fast decision,
matching rule and startup mode. Press `Space` to toggle Fast for the session, `m` to
switch auto/manual, `w` or `b` to edit the whitelist or blacklist, and `q` or `Esc`
to close. The list editor saves one glob per line to `extensions/fast-mode.json`,
with a backup of the previous file. Session mode and the manual switch are not
persisted by the panel.

| Command        | Action                                                                    |
| -------------- | ------------------------------------------------------------------------- |
| `/fast`        | Open the panel (show status outside the TUI).                             |
| `/fast toggle` | Flip the current policy decision and switch to manual mode.               |
| `/fast on`     | Switch to manual mode, on.                                                |
| `/fast off`    | Switch to manual mode, off.                                               |
| `/fast auto`   | Follow the configured lists as you switch models.                         |
| `/fast manual` | Return to the last manual setting (initially `enabled` in the config).    |
| `/fast status` | Show the mode, effective state and matching rule or reason for the model. |

To start a session in manual mode with Fast on:

```bash
pi --fast
```

Only models covered by `models` and a supported API are eligible. When active, Fast
publishes `ext:fast-mode` via `oh-my-line.segments.v1`, next to the model by default,
and uses Pi's native status as a fallback without oh-my-line. Manual changes last
until a new session, resume, or `/reload`.

## Supported providers

| Provider     | Pi provider    |
| ------------ | -------------- |
| OpenAI       | `openai`       |
| OpenAI Codex | `openai-codex` |

Priority availability depends on the provider and model.

## Configuration

Optionally create `<agent-dir>/extensions/fast-mode.json`, typically
`~/.pi/agent/extensions/fast-mode.json`. The defaults are:

```json
{
  "enabled": false,
  "models": [
    "openai/gpt-5.4",
    "openai/gpt-5.5",
    "openai/gpt-5.6-sol",
    "openai/gpt-5.6-terra",
    "openai/gpt-5.6-luna",
    "openai/gpt-6-astra",
    "openai/gpt-6-sol",
    "openai/gpt-6-luna",
    "openai/gpt-6.1-sol",
    "openai-codex/gpt-5.4",
    "openai-codex/gpt-5.5",
    "openai-codex/gpt-5.6-sol",
    "openai-codex/gpt-5.6-terra",
    "openai-codex/gpt-5.6-luna",
    "openai-codex/gpt-6-astra",
    "openai-codex/gpt-6-sol",
    "openai-codex/gpt-6-luna",
    "openai-codex/gpt-6.1-sol"
  ],
  "showStatus": true
}
```

| Setting      | Description                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `enabled`    | Initial manual on/off state. Existing configs using only `enabled` keep their behavior.                 |
| `mode`       | `auto` or `manual`. If omitted, supplying either list selects `auto`; otherwise `manual`.               |
| `models`     | Eligible `provider/model-id` keys or globs. Applies in both modes.                                      |
| `whitelist`  | Auto mode turns Fast on for matching eligible models. Unmatched models stay off.                        |
| `blacklist`  | Auto mode turns Fast off for matching models, even if also whitelisted. Manual mode ignores both lists. |
| `showStatus` | Show the footer segment while Fast is active.                                                           |

Patterns match the full `provider/model-id` key (case-insensitive); `*` matches any
number of characters, and `?` matches one. Use `"whitelist": ["*"]` to turn Fast on
for all eligible models except the blacklist. To set defaults without changing the
existing eligibility list, add these fields to your config:

```json
{
  "mode": "auto",
  "whitelist": ["cpa/gpt-6.2-sol", "openai-codex/gpt-6-*"],
  "blacklist": ["openai-codex/gpt-6-luna"]
}
```

Ensure that any custom provider keys you whitelist are also eligible via `models`.
When active, the extension adds `service_tier: "priority"` to supported requests that
do not already set a tier. When off, it leaves the payload unchanged.

## Notes

Priority inference can cost more. Check your provider's pricing before enabling it.
