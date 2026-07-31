# Pi Oscura Theme

Oscura Midnight theme and terminal skin for [Pi](https://pi.dev/).

A high-fidelity port of the way xAI's `grok` CLI looks. grok ships this palette
itself as `ThemeKind::OscuraMidnight`, so the colours, glyphs, formats and layout
here are literals taken from its source rather than eyeballed approximations —
see [docs/grok-fidelity-spec.md](docs/grok-fidelity-spec.md), which also records
the handful of things Pi's rendering model cannot express.

## Install

```bash
pi install npm:@joshbochu/pi-oscura-theme
```

Or from git:

```bash
pi install git:github.com/joshbochu/pi-oscura-theme
```

Local path (development):

```bash
pi install ~/dev/pi-oscura-theme
```

## Included

- `themes/oscura-midnight.json` — complete Pi theme, including grok's
  `grok-night.tmTheme` syntax colours (they are a different family from the
  chrome palette; deriving them from the purple accents is the single most
  visible way to get this theme wrong)
- `extensions/oscura-theme.ts` — rounded composer, prompt info line, turn-status
  row, autocomplete panel, footer
- `extensions/lib/` — the pure layout, format and phase logic, unit-tested
- `bin/gpi-preview` — isolated alternate-screen preview launcher

## What the skin renders

```
  ⠴ Responding… 1.7s · queued                         3.1s ⇣8.42k [stop]

  ╭─────────────────────────────────────────────── pi-oscura-theme ──╮
  │ ❯ Build anything                                                 │
  ╰──────────────────────────────── bedrock-claude-opus-5 • xhigh ───╯

  ⎇ fidelity │ ~/dev/pi-oscura-theme │ 21K / 1.0M
```

- **Turn-status row** — grok's 8-frame braille spinner at 133ms, the phase label
  (`Thinking…` / `Responding…` / `Running…` / `Compacting…`), phase timer, a
  `· queued` hint while steering input waits, turn timer, context tokens behind
  `⇣`, and `[stop]`, with a blank gap row before the prompt. Degrades
  field-by-field as the terminal narrows.
- **Prompt box** — rounded frame inside grok's 2-column outer pad; the border
  brightens `border` → `borderAccent` on focus and the whole interior fades
  toward the canvas when focus leaves, grok-style. Session title and
  `model • effort` share the focus-graded caption on the borders, a recognised
  `/command` lights up purple, and `Build anything` shows while the buffer is
  empty and unfocused. The `❯` never turns into a spinner (and is never bold);
  grok keeps it still.
- **Completion dropdown** — grok's panel chrome above the box: `bg_highlight`
  rules with the match count riding the top rule, a `bg_light` body, up to 6
  rows with the typed prefix highlighted in lavender, and the selected row
  bold on `bg_visual` behind a still `❯`.
- **Footer** — branch, path, and the context chip on grok's usage gradient
  (white → lavender → gold → red across 50/75/95%), a blank row under the box.
- **Markdown** — `#` markers hidden at every level, `•` bullets, a three-column
  rule, and fenced code with the fences dropped and a background band behind the
  syntax-highlighted lines. H1 takes grok's white, H2 its lavender; h3-h6 share
  the lavender because Pi hands over a heading's level only after it has styled
  the text.

## Preview

From a clone, or after install:

```bash
./bin/gpi-preview
# or
npx --yes --package=@joshbochu/pi-oscura-theme gpi-preview
```

Pass normal Pi arguments after the launcher:

```bash
./bin/gpi-preview --thinking low \
  "Show a short theme preview with headings, bullets, and code. Do not use tools."
```

Set `PI_OSCURA_ALT_SCREEN=0` to keep Pi in normal terminal scrollback.

## `/oscura` visibility settings

Run `/oscura` in Pi to open the Oscura UI Settings overlay. Use the configured Pi
selection keys (arrow keys by default) to navigate, Enter or Space to change a
setting, and Escape to close. Changes apply immediately.

The overlay controls each region independently:

- session title on the top border
- cwd fallback when an unnamed session has no explicit title
- model and thinking-effort caption on the lower border
- Git branch in the footer
- current directory in the footer
- context usage in the footer
- turn-status row above the editor

All regions are shown by default. **Reset to defaults** restores that state.
**Use Minimal preset** hides all seven configurable regions; each toggle can
still be changed afterward.

Settings are global and persist across Pi restarts in Oscura's extension-owned
`oscura-theme.json` under Pi's agent directory—normally
`~/.pi/agent/oscura-theme.json`, or the directory selected by
`PI_CODING_AGENT_DIR`. Writes are atomic, and missing or malformed settings
safely fall back to the defaults. Oscura does not add private keys to Pi's main
`settings.json`.

The completion dropdown, placeholder, prompt marker, terminal canvas, and
markdown skin are not controlled by `/oscura`.

## Terminal canvas

The skin temporarily sets the terminal default background to `#030304` with OSC 11, then restores the terminal profile default with OSC 111 when Pi shuts down. Terminals without dynamic-color support ignore these sequences.

Disable this behavior for one run:

```bash
PI_OSCURA_TERMINAL_CANVAS=0 pi
```

After an ungraceful process kill, reset the terminal background manually:

```bash
printf '\e]111\a'
```

## Notes

The extension applies `oscura-midnight` in memory at TUI startup. Set `PI_OSCURA_KEEP_POWERBAR=1` to retain pi-powerbar's widget.

The cursor is set to the theme's accent with OSC 12 and restored with OSC 112,
alongside the canvas sequences above.

## Development

No dependencies and no build step. Node strips the TypeScript, and `tsc` runs
against the peer packages symlinked into `node_modules/`.

`npm test` relies on Node's built-in type stripping: use Node ≥ 22.18 (where
it is on by default), or pass `--experimental-strip-types` on older 22.x.

```bash
npm test        # node --test over extensions/lib/*.test.ts
npm run typecheck
```

Everything with layout or format logic lives in `extensions/lib/` as a pure
module so it can be tested without booting a TUI. `extensions/oscura-theme.ts`
is the wiring layer, verified by running Pi under a pty and inspecting the
emitted frames.

## Recommended Pi settings

Recommended Pi settings:

```json
{
  "editorPaddingX": 2,
  "outputPad": 1,
  "hideThinkingBlock": true
}
```
