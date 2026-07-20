# Pi Grok Build Skin

No-fork Pi skin based on Grok Build's Oscura Midnight palette and terminal chrome.

## Included

- `themes/oscura-midnight.json` — complete 51-token Pi theme
- `extensions/grok-build-skin.ts` — boxed editor, top autocomplete panel, activity row, compact footer
- `bin/gpi-preview` — isolated alternate-screen preview launcher

## Preview

```bash
~/pi-grok-build-skin/bin/gpi-preview
```

Pass normal Pi arguments after the launcher:

```bash
~/pi-grok-build-skin/bin/gpi-preview --thinking low \
  "Show a short theme preview with headings, bullets, and code. Do not use tools."
```

Set `PI_GROK_ALT_SCREEN=0` to keep Pi in normal terminal scrollback.

## Terminal canvas

The skin temporarily sets the terminal's default background to Oscura Midnight base `#030304` with OSC 11, then restores the terminal profile default with OSC 111 when Pi shuts down. This fills the canvas that Pi leaves unstyled. Terminals without dynamic-color support simply ignore the sequence.

Disable this behavior for one run:

```bash
PI_GROK_TERMINAL_CANVAS=0 pi
```

After an ungraceful process kill, reset the terminal background manually with `printf '\e]111\a'`. A terminal profile background of `#030304` remains the most crash-proof fallback. Pi cannot change the terminal font; use a crisp monospace font with truecolor enabled.

## Global installation

After preview approval:

```bash
pi install ~/pi-grok-build-skin
```

The extension applies `oscura-midnight` in memory on TUI startup. Base theme settings stay unchanged. The skin suppresses pi-powerbar's extra widget while owning terminal chrome; set `PI_GROK_KEEP_POWERBAR=1` to keep that row.

## Settings

Recommended global settings:

```json
{
  "editorPaddingX": 2,
  "outputPad": 1,
  "hideThinkingBlock": true
}
```

Hidden thinking renders as `◆ Thought`.

## Provenance

Palette and layout cues derived from xAI's Apache-2.0-licensed Grok Build repository:

- https://github.com/xai-org/grok-build
- `crates/codegen/xai-grok-pager-render/src/theme/oscura.rs`
- `crates/codegen/xai-grok-pager-render/src/glyphs.rs`
- `crates/codegen/xai-grok-pager/src/views/slash_dropdown.rs`
- `crates/codegen/xai-grok-pager/docs/user-guide/06-theming.md`

This package changes Pi presentation only. It does not include xAI code or services.
