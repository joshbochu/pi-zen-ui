# Handoff: Pi Grok Build Skin

## Current state

Working no-fork Grok Build-inspired skin for Pi `0.80.6`.

- Built at: `/Users/jb/pi-grok-build-skin`
- Installed globally as local package: `../../pi-grok-build-skin`
- Global Pi settings: `/Users/jb/.pi/agent/settings.json`
- Pre-install settings backup: `/Users/jb/.pi/agent/settings.json.grok-skin.20260719T215844.bak`
- Package directory is a clean Git repository on branch `main`; latest commit contains the approved composer geometry.
- Base Pi theme remains `dark`; extension applies `oscura-midnight` in memory.
- Extension temporarily sets terminal canvas background to `#030304` with OSC 11 and restores the profile default with OSC 111.
- Handoff refreshed and implementation validated on `2026-07-20`.

## Next session quick start

1. `cd /Users/jb/pi-grok-build-skin`
2. Read this file and `extensions/grok-build-skin.ts` before editing.
3. Run `/reload` in the active Pi session, or launch `bin/gpi-preview` for isolation.
4. Type `/` without pressing Enter to inspect the autocomplete panel.
5. Capture a screenshot before changing geometry or colors.

Current user preferences:

- Grok Build's Oscura Midnight palette and identifier
- Full terminal canvas uses `#030304` while Pi runs, then resets on shutdown
- Input editor must be an inset rectangle, not full-width horizontal rules
- Rectangle uses rounded `╭ ╮ ╰ ╯` corners and vertical sides with no extra skin margin; terminal padding supplies the visual edge inset
- Prompt arrow uses 1 blank cell after the left border, matching the 27px logical inset in the Retina reference screenshot
- Bottom shortcut row (`shift+tab:mode │ …`) must stay hidden
- Footer stays 1 CWD/branch-only line
- Model, thinking level, and context percentage stay in the lower editor border
- Lower-border metadata ends with ` · 0% ─╯`: 1 space separates text, then 1 border segment reconnects the rounded corner
- Empty composer must stay compact at 3 rows: top, body, bottom/metadata
- A separate metadata row was tried and rejected because it made the composer too tall
- Slash/autocomplete menu stays above the editor with Grok-style chrome
- `pi-powerbar` stays installed but its extra visible widget is suppressed

## File map

| Path | Purpose |
|---|---|
| `package.json` | Pi package manifest; exports extension and theme |
| `themes/oscura-midnight.json` | Grok Oscura Midnight-derived Pi theme: 51 required tokens plus optional `thinkingMax` |
| `extensions/grok-build-skin.ts` | All runtime chrome and lifecycle behavior |
| `bin/gpi-preview` | Isolated preview launcher using temporary Pi config and alternate screen |
| `README.md` | User-facing installation and preview notes |
| `HANDOFF.md` | This continuation guide |

## Runtime architecture

### Theme loading

`extensions/grok-build-skin.ts` computes `THEME_PATH` relative to `import.meta.url`.

The extension returns that file from `resources_discover`, then applies the theme on the next event-loop tick:

1. `session_start` runs first.
2. `resources_discover` contributes `THEME_PATH`.
3. Pi registers discovered themes.
4. Deferred callback calls `ctx.ui.getTheme("oscura-midnight")`.
5. Callback passes the returned `Theme` instance to `ctx.ui.setTheme()`.

Do **not** move theme lookup back into `session_start`; that caused:

```text
Warning: Grok skin theme unavailable: Theme not found: oscura-midnight
```

Do **not** call `ctx.ui.setTheme("oscura-midnight")` by name unless persistence is intended. Name-based switching writes the global theme setting. Passing a `Theme` instance applies it only in memory.

### Terminal canvas

Pi's theme schema exposes only component backgrounds (`selectedBg`, message backgrounds, and tool backgrounds). It has no TUI canvas token. Pi's root `Container` concatenates component lines, and the renderer clears untouched cells to the terminal's default background. ANSI capture confirmed the skin emitted `customMessageBg` and `selectedBg` but no `#030304` base-canvas background.

Grok Build differs: `views/agent.rs::fill_background()` sets every Ratatui buffer cell in the assigned screen area to `theme.bg_base` before rendering child views.

The no-fork bridge is terminal dynamic-color control:

- `session_start` writes OSC 11 with `#030304`.
- `session_shutdown` writes OSC 111 to restore the terminal profile default.
- A process `exit` listener provides an additional synchronous reset path.
- `/reload` resets the old runtime, then reapplies the canvas from the new runtime.
- `PI_GROK_TERMINAL_CANVAS=0` disables both set and reset sequences.
- SIGKILL or terminal failure can bypass cleanup; run `printf '\e]111\a'` to reset manually.
- Unsupported terminals ignore the control sequence; set the terminal profile background to `#030304` instead.

This changes the terminal tab's default background, not Pi's component tree or font.

### Editor rectangle

`GrokEditor extends CustomEditor`.

Important symbols:

- `setPaddingX()` forces 2 columns because Pi reapplies editor padding after construction.
- `render()` calls the base editor with reduced inner width.
- `CHROME_MARGIN` controls any shared inset for the editor, activity row, and footer; current value is `0`.
- `outerMargin` applies that inset outside the editor rectangle.
- `contentWidth` reserves room for margins and vertical borders.
- `PROMPT_INSET` reserves 1 cell before `❯`; `baseEditorWidth` shrinks by the same amount so wrapping and cursor geometry remain correct.
- `borderLineIndex()` locates the base editor's bottom border safely through ANSI output.
- Top/body/bottom lines become `╭─╮`, `│ │`, and `╰─╯` for the smoothest curve available on a terminal character grid.
- Prompt prefix renders as `│ ❯ text`; continuation rows render as `│   text` so text columns align.
- Model, thinking level, and rounded context percentage render inside the lower border; `cornerConnector` adds border-colored `─` before `╯`.
- Autocomplete rows move above the editor without replacing Pi's completion behavior.
- Autocomplete chrome uses `─` dividers, top-right match count, selected background, and `❯ ` selection prefix.

Current geometry:

```ts
const CHROME_MARGIN = 0;
const PROMPT_INSET = 1;
const outerMargin = width >= 12 ? CHROME_MARGIN : 0;
const contentWidth = Math.max(1, width - outerMargin * 2 - 2);
const baseEditorWidth = Math.max(1, contentWidth - PROMPT_INSET);
```

The original 2-column inset measured roughly 50px from the physical window edge. A 1-column inset still measured roughly 40px. The user wants 32px on both sides, so the skin now adds no terminal-cell margin and relies on the terminal application's own padding. A 32px left/40px right physical gap can still occur because terminals fit only whole character cells and leave remainder pixels on the right; Pi cannot draw into that fractional-cell remainder. Keep every rendered line at or below `width`; use `visibleWidth()` and `truncateToWidth()` for ANSI-safe sizing.

Upgrade-sensitive details:

- `borderLineIndex()` depends on Pi's base editor border text shape.
- `autocompleteItemCount()` reads runtime-private `autocompleteList.filteredItems` through a narrow cast only to show the top-right count.
- Pi upgrades can change either internal shape; re-test `/` completion after every upgrade.
- The skin reorders rendered autocomplete rows only; Pi still owns filtering, navigation, acceptance, and cancellation.

### Activity row

`installTurnStatus()` replaces Pi's normal working row with a widget above the editor.

State comes from:

- `agent_start` → `Thinking…`
- `turn_start` → `Waiting for response…`
- thinking stream events → `Thinking…`
- text stream events → `Responding…`
- tool execution events → `Read …`, `Edit …`, `Run …`, etc.
- `agent_settled` → hide row

The widget refreshes every 120 ms only while active. Its `dispose()` clears the timer.

### Footer

`installFooter()` renders exactly 1 line:

- Left: CWD and optional Git branch
- No right-side token counter; context percentage lives beside the model in the editor border

The shortcut-hint row was intentionally removed. Do not restore it unless requested.

### Powerbar coexistence

`@juanibiapina/pi-powerbar` uses widget key `powerbar` and can re-add itself after startup.

The skin:

- clears `powerbar` during `session_start`
- listens for `powerbar:update`
- clears the widget again after each update

Override for one run:

```bash
PI_GROK_KEEP_POWERBAR=1 pi
```

## Theme palette

Primary Oscura Midnight values live under `vars` in `themes/oscura-midnight.json`.

| Role | Value |
|---|---|
| Base canvas reference | `#030304` |
| Surface/tool background | `#040507` |
| Elevated user background | `#0f1216` |
| Low highlight | `#12101c` |
| Selected/hover highlight | `#242034` |
| Active border | `#343048` |
| Primary text | `#e4e4e4` |
| Secondary text | `#bebebe` |
| Muted text | `#81868f` |
| Subtle text | `#5e646c` |
| Purple | `#9b7ece` |
| Bright purple | `#c4a7e7` |
| Cyan | `#7dcfdf` |
| Gold | `#ebd96e` |
| Teal | `#50b48c` |
| Red | `#dc5a64` |

Pi has one `mdHeading` token, unlike Grok Build's per-heading colors. Current compromise uses Oscura bright purple for all Markdown headings.

Pi theme JSON cannot set the entire TUI canvas or font. The extension now bridges the canvas gap with OSC 11/111; setting the terminal profile background to `#030304` remains the crash-proof fallback.

## Iteration workflow

Edits are live because Pi loads the installed package from the local directory.

After changing extension or theme:

```text
/reload
```

Clean isolated preview:

```bash
/Users/jb/pi-grok-build-skin/bin/gpi-preview
```

Preview with generated Markdown content:

```bash
/Users/jb/pi-grok-build-skin/bin/gpi-preview --thinking low \
  "Create a compact visual showcase with headings, bullets, and code. Do not call tools."
```

Disable alternate screen while debugging:

```bash
PI_GROK_ALT_SCREEN=0 /Users/jb/pi-grok-build-skin/bin/gpi-preview
```

Disable temporary terminal-canvas coloring:

```bash
PI_GROK_TERMINAL_CANVAS=0 /Users/jb/pi-grok-build-skin/bin/gpi-preview
```

Basic checks:

```bash
python3 -m json.tool \
  /Users/jb/pi-grok-build-skin/themes/oscura-midnight.json >/dev/null

bash -n /Users/jb/pi-grok-build-skin/bin/gpi-preview

PI_SKIP_VERSION_CHECK=1 pi --no-session --no-context-files
```

Current validation state (`2026-07-20`):

- Theme JSON parses
- All 51 required Pi tokens exist
- Optional `thinkingMax` exists
- No unknown theme tokens
- Extension passes strict TypeScript checking against Pi `0.80.6`
- Isolated TUI startup resolves `oscura-midnight` without warning
- Empty composer stays 3 rows with inline `model · thinking · context%`
- Autocomplete panel renders above the composer with count and `❯` selection
- 120×36 tmux capture confirms editor borders occupy columns 0–119 with no skin margin
- Rounded `╭ ╮ ╰ ╯` composer corners render at full width without overflow
- Multiline capture confirms `│ ❯ ff` and `│   fff` align text columns with a 1-cell arrow inset
- Lower border ends with `· 0% ─╯`, preserving metadata spacing while reconnecting the rounded corner
- Boxed editor gained 4 columns of width versus the original 2-column margins
- Boxed editor and single-line footer render within terminal width
- Package resource-load smoke test passes with explicit extension/theme paths
- OSC canvas smoke test emits 1 set and 1 reset on normal exit
- `/reload` smoke test emits balanced reset/set pairs with no listener warning
- `PI_GROK_TERMINAL_CANVAS=0` emits neither sequence
- No temporary `interactive_shell` sessions remain

There is no project `tsconfig.json` or local `node_modules`. The strict check used temporary symlinks to Pi `0.80.6`, `pi-tui`, and `@types/node`; rerun against the installed Pi package after code changes.

## Global settings notes

Verified relevant values in `/Users/jb/.pi/agent/settings.json`:

- `defaultThinkingLevel`: `xhigh`
- `hideThinkingBlock`: `false`
- base `theme`: `dark`
- package entry: `../../pi-grok-build-skin`
- many unrelated packages also exist; do not replace the full `packages` array

`hideThinkingBlock` remains `false` globally. If changed to `true`, hidden reasoning uses the extension label:

```text
◆ Thought
```

The extension's boxed editor enforces its own 2-column internal padding, so global `editorPaddingX` is not required.

## Known no-fork limits

Public Pi extension APIs cannot fully reproduce:

- fixed Grok fullscreen root viewport
- persistent top status bar
- internal scrollbar
- sticky user-message headers
- mouse-selectable/foldable built-in transcript blocks
- six distinct Markdown heading colors
- complete replacement of built-in user/assistant transcript renderers

Current implementation targets Grok-like palette and terminal chrome without modifying Pi core.

## Troubleshooting

### Theme unavailable warning

Keep theme registration in `resources_discover` and application deferred with `setTimeout(..., 0)`. Confirm startup lists:

```text
[Themes]
  oscura-midnight
```

### Prompt arrow disappears

Confirm `GrokEditor.setPaddingX()` still forces `2` and the first body row replaces those spaces with `❯ `. Pi otherwise resets the custom editor to global padding.

### Autocomplete returns below editor

Keep the `borderLineIndex()` split in `GrokEditor.render()`. Pi appends autocomplete rows after its bottom border; the skin extracts those rows, removes Pi's `(n/total)` row, adds Grok dividers/count, then prepends the panel above the boxed editor.

### Extra status or powerbar row appears

Confirm the `powerbar:update` listener still clears widget key `powerbar`. Also check `PI_GROK_KEEP_POWERBAR` is not `1`.

### Shortcut row returns

`installFooter().render()` should return only the CWD/branch line:

```ts
return [truncateToWidth(theme.fg("dim", left), width, "…")];
```

### Terminal canvas stays changed after a crash

Run:

```bash
printf '\e]111\a'
```

For guaranteed recovery from SIGKILL, set the terminal profile background to `#030304` instead of relying on runtime switching, or launch with `PI_GROK_TERMINAL_CANVAS=0`.

### Theme changes global settings unexpectedly

Use:

```ts
const theme = ctx.ui.getTheme(THEME_NAME);
if (theme) ctx.ui.setTheme(theme);
```

Do not use the theme name directly.

## Rollback

Remove only this package:

```bash
pi remove /Users/jb/pi-grok-build-skin
```

Or remove this entry from `/Users/jb/.pi/agent/settings.json`:

```json
"../../pi-grok-build-skin"
```

Full settings backup:

```text
/Users/jb/.pi/agent/settings.json.grok-skin.20260719T215844.bak
```

## Provenance

Reference repository and snapshot used during investigation:

- https://github.com/xai-org/grok-build
- GitHub commit inspected: `ba76b0a683fa52e4e60685017b85905451be17bc`
- Grok source revision: `ba69d70c2f7d70a130a323b2becdf137af784c7f`
- Palette source: `crates/codegen/xai-grok-pager-render/src/theme/oscura.rs`
- Prompt glyph source: `crates/codegen/xai-grok-pager-render/src/glyphs.rs`
- Dropdown rows: `crates/codegen/xai-grok-pager/src/views/slash_dropdown.rs`
- Dropdown chrome: `crates/codegen/xai-grok-pager/src/app/agent_view/mod.rs`
- Theming guide: `crates/codegen/xai-grok-pager/docs/user-guide/06-theming.md`

Grok Build is Apache-2.0 licensed. This package reimplements presentation behavior through Pi's public APIs and does not include xAI services.

## Next-session priorities

1. Run `/reload` to load the committed composer geometry in the normal Pi session.
2. Compare `/` autocomplete against the supplied Grok screenshot at the user's normal terminal width.
3. Change geometry only after a fresh screenshot identifies a specific mismatch.
4. Re-run strict TypeScript, theme-token, resource-load, and TUI smoke checks after every edit.

Deferred ideas, not approved work:

- compact custom tool renderers
- GrokDay theme variant
- deeper transcript chrome changes within public API limits
