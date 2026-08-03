# PiGrokBuild UI

PiGrokBuild UI is an unofficial, high-fidelity port of the
[Grok Build](https://x.ai/build) terminal interface for
[Pi](https://pi.dev/).

It brings the parts of Grok Build's presentation layer that Pi can express:
the Oscura Midnight canvas, composer and completion chrome, turn status,
footer, Markdown treatment, cursor, and appearance controls. The colours,
glyphs, formats, and layout are taken from the upstream source rather than
eyeballed—see [docs/grok-fidelity-spec.md](docs/grok-fidelity-spec.md) for the
ground truth and the remaining rendering differences.

PiGrokBuild UI is an independent compatibility project. Its scope ends at the
presentation and interaction layer: it does not include xAI models,
authentication, tools, workflows, or the Grok Build agent runtime. Pi continues
to provide the agent underneath the interface, and broader behavior can be
added as separate Pi extensions alongside this package.

## Install

```bash
pi install npm:@joshbochu/pi-grok-build-ui
```

Or from git:

```bash
pi install git:github.com/joshbochu/pi-grok-build-ui
```

Local path (development):

```bash
pi install ~/dev/pi-grok-build-ui
```

Upgrading from `@joshbochu/pi-oscura-theme`:

```bash
pi remove npm:@joshbochu/pi-oscura-theme
pi install npm:@joshbochu/pi-grok-build-ui
```

Removing the former package first prevents both extensions from owning the same
Pi interface. Existing appearance settings are carried forward automatically.

## Included

- `themes/oscura-midnight.json` — complete Pi theme, including grok's
  `grok-night.tmTheme` syntax colours (they are a different family from the
  chrome palette; deriving them from the purple accents is the single most
  visible way to get this theme wrong)
- `extensions/pi-grok-build-ui.ts` — rounded composer, prompt info line,
  turn-status row, autocomplete panel, footer
- `extensions/lib/` — the pure layout, format and phase logic, unit-tested
- `bin/pi-grok-build-ui-preview` — isolated alternate-screen preview launcher

## What PiGrokBuild UI renders

```
  ⠴ Responding… 1.7s · queued                         3.1s ⇣8.42k [stop]

  ╭─────────────────────────────────────────────── pi-grok-build-ui ──╮
  │ ❯ Build anything                                                 │
  ╰──────────────────────────────── bedrock-claude-opus-5 • xhigh ───╯

  ⎇ fidelity │ ~/dev/pi-grok-build-ui │ 21K / 1.0M
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
  `/command` lights up in the selected accent, and `Build anything` shows while
  the buffer is empty and unfocused. The `❯` never turns into a spinner (and is
  never bold); grok keeps it still.
- **Completion dropdown** — grok's panel chrome above the box: `bg_highlight`
  rules with the match count riding the top rule, a `bg_light` body, up to 6
  rows with the typed prefix highlighted in the selected accent, and the
  selected row bold on `bg_visual` behind a still `❯`.
- **Footer** — branch, path, and the context chip on grok's usage gradient
  (white → accent → gold → red across 50/75/95%), a blank row under the box.
- **Markdown** — `#` markers hidden at every level, `•` bullets, a three-column
  rule, and fenced code with the fences dropped and a background band behind the
  syntax-highlighted lines. H1 takes grok's white, H2 the selected accent;
  h3-h6 share that accent because Pi hands over a heading's level only after it
  has styled the text.

## Preview

From a clone, or after install:

```bash
./bin/pi-grok-build-ui-preview
# or
npx --yes --package=@joshbochu/pi-grok-build-ui pi-grok-build-ui-preview
```

Pass normal Pi arguments after the launcher:

```bash
./bin/pi-grok-build-ui-preview --thinking low \
  "Show a short theme preview with headings, bullets, and code. Do not use tools."
```

Set `PI_GROK_BUILD_UI_ALT_SCREEN=0` to keep Pi in normal terminal scrollback.

## `/pi-grok-build-ui` appearance settings

Run `/pi-grok-build-ui` in Pi to open the PiGrokBuild UI Settings overlay. Use
the configured Pi selection keys (arrow keys by default) to navigate, Enter or
Space to change a setting, and Escape to close. Changes apply immediately. The
former `/oscura` command remains as a compatibility alias.

### Accent colors

**Color preset** cycles between:

- **Oscura** — the original lavender ramp (`#C4A7E7`, `#9B7ECE`, `#6E5A9A`)
- **Nord Frost** — Nord's blue ramp (`#88C0D0`, `#81A1C1`, `#5E81AC`)
- **Custom** — the last custom accent entered

**Accent color** displays a colored swatch and the effective hex value. Select it
to open the `#RRGGBB` editor; its swatch previews the value while you type, Enter
applies it, and Escape cancels. A custom bright accent automatically derives
coherent core, dim, active-border, selected-row, and highlight shades.

Accent customization recolors the prompt arrow and cursor, headings, labels and
spinner, active borders, selected backgrounds, completion matches, thinking
accent, and context gradient. It deliberately keeps Oscura's near-black canvas,
syntax highlighting, and semantic success/error/warning colors.

### Visibility

The overlay also controls each region independently:

- session title on the top border
- cwd fallback when an unnamed session has no explicit title
- model and thinking-effort caption on the lower border
- Git branch in the footer
- current directory in the footer
- context usage in the footer
- turn-status row above the editor

All regions are shown by default. **Reset visibility** restores that state.
**Use Minimal visibility** hides all seven configurable regions; neither action
changes the selected accent, and each toggle can still be changed afterward.

Settings are global and persist across Pi restarts in PiGrokBuild UI's
extension-owned `pi-grok-build-ui.json` under Pi's agent directory—normally
`~/.pi/agent/pi-grok-build-ui.json`, or the directory selected by
`PI_CODING_AGENT_DIR`. Writes are atomic, and missing or malformed settings
safely fall back to the defaults. PiGrokBuild UI reads the former
`oscura-theme.json` when the new file does not exist, so existing appearance
settings carry forward. It does not add private keys to Pi's main
`settings.json`.

The completion dropdown, prompt marker, headings, and context gradient inherit
the selected accent. Their structure, the placeholder, terminal canvas color,
and markdown layout are not configurable.

## Terminal canvas

The skin temporarily sets the terminal default background to `#030304` with OSC 11, then restores the terminal profile default with OSC 111 when Pi shuts down. Terminals without dynamic-color support ignore these sequences.

Disable this behavior for one run:

```bash
PI_GROK_BUILD_UI_TERMINAL_CANVAS=0 pi
```

After an ungraceful process kill, reset the terminal background manually:

```bash
printf '\e]111\a'
```

## Notes

The extension builds `oscura-midnight` in memory at TUI startup using the saved
accent selection. Set `PI_GROK_BUILD_UI_KEEP_POWERBAR=1` to retain
pi-powerbar's widget. The former `PI_OSCURA_*` names remain supported for
compatibility.

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
module so it can be tested without booting a TUI.
`extensions/pi-grok-build-ui.ts` is the wiring layer, verified by running Pi
under a pty and inspecting the emitted frames.

## Recommended Pi settings

```json
{
  "editorPaddingX": 2,
  "outputPad": 1,
  "hideThinkingBlock": true
}
```
