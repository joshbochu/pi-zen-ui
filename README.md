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
  ╰──────────────────────────────── bedrock-claude-opus-5 (xhigh) ───╯

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
  `model (effort)` share the focus-graded caption on the borders, a recognised
  `/command` lights up purple, and `Build anything` shows while the buffer is
  empty and unfocused. The `❯` never turns into a spinner (and is never bold);
  grok keeps it still.
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

```bash
npm test        # node --test over extensions/lib/*.test.ts
npm run typecheck
```

Everything with layout or format logic lives in `extensions/lib/` as a pure
module so it can be tested without booting a TUI. `extensions/oscura-theme.ts`
is the wiring layer, verified by running Pi under a pty and inspecting the
emitted frames.

## Settings

Recommended Pi settings:

```json
{
  "editorPaddingX": 2,
  "outputPad": 1,
  "hideThinkingBlock": true
}
```
