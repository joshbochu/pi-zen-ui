# Pi Oscura Theme

Oscura Midnight theme and terminal skin for Pi.

## Included

- `themes/oscura-midnight.json` — complete Pi theme
- `extensions/oscura-theme.ts` — rounded composer, autocomplete panel, activity row, and compact footer
- `bin/gpi-preview` — isolated alternate-screen preview launcher

## Preview

```bash
~/pi-oscura-theme/bin/gpi-preview
```

Pass normal Pi arguments after the launcher:

```bash
~/pi-oscura-theme/bin/gpi-preview --thinking low \
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

## Installation

```bash
pi install ~/pi-oscura-theme
```

The extension applies `oscura-midnight` in memory at TUI startup. Set `PI_OSCURA_KEEP_POWERBAR=1` to retain pi-powerbar's widget.

## Settings

Recommended Pi settings:

```json
{
  "editorPaddingX": 2,
  "outputPad": 1,
  "hideThinkingBlock": true
}
```
